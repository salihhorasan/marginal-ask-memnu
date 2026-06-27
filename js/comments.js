import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// ---------------------------------------------------------------
// DOM referansları
// ---------------------------------------------------------------
const commentFormArea = document.getElementById("comment-form-area");
const commentListEl   = document.getElementById("comment-list");
const commentsEmpty   = document.getElementById("comments-empty");

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------
let currentUser = null;           // Firebase Auth user
let currentUserBanned = false;    // isBanned durumu
let slug = null;                  // Mevcut video slug'ı
const usernameCache = new Map();  // uid → displayUsername önbelleği

// ---------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------

/** Göreli tarih: "az önce", "2 gün önce", "1 ay önce" vb. */
function timeAgo(date) {
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours   = Math.floor(minutes / 60);
  const days    = Math.floor(hours / 24);
  const weeks   = Math.floor(days / 7);
  const months  = Math.floor(days / 30);

  if (seconds < 60)  return "az önce";
  if (minutes < 60)  return `${minutes} dakika önce`;
  if (hours < 24)    return `${hours} saat önce`;
  if (days < 7)      return `${days} gün önce`;
  if (weeks < 5)     return `${weeks} hafta önce`;
  if (months < 12)   return `${months} ay önce`;
  return `${Math.floor(months / 12)} yıl önce`;
}

/** usernames koleksiyonundan uid → displayUsername çözümle */
async function resolveUsername(uid) {
  if (usernameCache.has(uid)) return usernameCache.get(uid);

  // usernames koleksiyonu uid'ye göre değil, lowercase username'e göre key'li.
  // uid → username eşlemesi users/{uid}.username'den çekilemez çünkü
  // users/{uid} sadece sahibine açık. Bunun yerine usernames koleksiyonunda
  // uid alanı eşleşen dokümanı arıyoruz — ama list sorgusu engellenmiş olabilir.
  //
  // Alternatif yol: users/{uid} erişimi permission-denied döner (sahibi değilsek).
  // Yorumlarda username göstermek için usernames koleksiyonunu kullanmamız lazım.
  // Ancak usernames koleksiyonunda "where uid ==" sorgusu yapılabilir (read: true).

  try {
    const snap = await getDocs(
      query(collection(db, "usernames"), where("uid", "==", uid))
    );
    if (!snap.empty) {
      const username = snap.docs[0].data().displayUsername;
      usernameCache.set(uid, username);
      return username;
    }
  } catch (err) {
    console.error("Username çözümlenemedi:", err);
  }

  usernameCache.set(uid, "Silinmiş Kullanıcı");
  return "Silinmiş Kullanıcı";
}

/** Toast mesajı göster */
function showToast(message) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2500);
}

// ---------------------------------------------------------------
// Yorum listesini yükle
// ---------------------------------------------------------------

async function loadComments() {
  if (!slug) return;

  commentListEl.innerHTML = "";

  let snapshot;
  try {
    const q = query(
      collection(db, "videos", slug, "comments"),
      orderBy("createdAt", "desc")
    );
    snapshot = await getDocs(q);
  } catch (err) {
    console.error("Yorumlar yüklenemedi:", err);
    commentListEl.innerHTML =
      '<p class="empty-state">Yorumlar yüklenirken bir hata oluştu.</p>';
    return;
  }

  if (snapshot.empty) {
    commentsEmpty.style.display = "block";
    commentListEl.appendChild(commentsEmpty);
    return;
  }

  commentsEmpty.style.display = "none";

  // Tüm benzersiz uid'leri topla, username'leri paralel çözümle
  const comments = [];
  snapshot.forEach((snap) => {
    comments.push({ id: snap.id, ...snap.data() });
  });

  const uniqueUids = [...new Set(comments.map((c) => c.userId))];
  await Promise.all(uniqueUids.map(resolveUsername));

  // Kartları oluştur
  comments.forEach((comment) => {
    const card = createCommentCard(comment);
    commentListEl.appendChild(card);
  });
}

// ---------------------------------------------------------------
// Yorum kartı oluştur
// ---------------------------------------------------------------

function createCommentCard(comment) {
  const card = document.createElement("div");
  card.className = "comment-card";
  card.dataset.commentId = comment.id;

  // Üst satır: kullanıcı adı + tarih
  const header = document.createElement("div");
  header.className = "comment-header";

  const userSpan = document.createElement("span");
  userSpan.className = "comment-user";
  userSpan.textContent = usernameCache.get(comment.userId) || "Anonim";

  const dateSpan = document.createElement("span");
  dateSpan.className = "comment-date";
  dateSpan.textContent = comment.createdAt
    ? timeAgo(comment.createdAt.toDate())
    : "";

  header.append(userSpan, dateSpan);

  // Yorum metni
  const textP = document.createElement("p");
  textP.className = "comment-text";
  textP.textContent = comment.text;

  card.append(header, textP);

  // Aksiyonlar (sadece login ise göster)
  if (currentUser) {
    const actions = document.createElement("div");
    actions.className = "comment-actions";

    if (currentUser.uid === comment.userId) {
      // Kendi yorumu → Sil
      const delBtn = document.createElement("button");
      delBtn.className = "comment-action-btn delete-btn";
      delBtn.textContent = "Sil";
      delBtn.addEventListener("click", () => showDeleteConfirm(card, comment.id));
      actions.appendChild(delBtn);
    } else {
      // Başkasının yorumu → Raporla
      const reportBtn = document.createElement("button");
      reportBtn.className = "comment-action-btn report-btn";
      reportBtn.textContent = "Raporla";
      reportBtn.addEventListener("click", () => showReportConfirm(card, comment));
      actions.appendChild(reportBtn);
    }

    card.appendChild(actions);
  }

  return card;
}

// ---------------------------------------------------------------
// Silme onay overlay'i
// ---------------------------------------------------------------

function showDeleteConfirm(card, commentId) {
  // Zaten overlay varsa tekrar ekleme
  if (card.querySelector(".confirm-overlay")) return;

  const overlay = document.createElement("div");
  overlay.className = "confirm-overlay";

  const msg = document.createElement("p");
  msg.textContent = "Bu yorumu silmek istediğine emin misin?";

  const buttons = document.createElement("div");
  buttons.className = "confirm-buttons";

  const yesBtn = document.createElement("button");
  yesBtn.className = "confirm-yes";
  yesBtn.textContent = "Evet, sil";
  yesBtn.addEventListener("click", async () => {
    yesBtn.disabled = true;
    yesBtn.textContent = "Siliniyor…";
    try {
      await deleteDoc(doc(db, "videos", slug, "comments", commentId));
      card.remove();
      showToast("Yorum silindi.");

      // Liste boş kaldıysa empty state göster
      if (commentListEl.querySelectorAll(".comment-card").length === 0) {
        commentsEmpty.style.display = "block";
        commentListEl.appendChild(commentsEmpty);
      }
    } catch (err) {
      console.error("Yorum silinemedi:", err);
      showToast("Yorum silinirken bir hata oluştu.");
      overlay.remove();
    }
  });

  const noBtn = document.createElement("button");
  noBtn.className = "confirm-no";
  noBtn.textContent = "Vazgeç";
  noBtn.addEventListener("click", () => overlay.remove());

  buttons.append(noBtn, yesBtn);
  overlay.append(msg, buttons);
  card.appendChild(overlay);
}

// ---------------------------------------------------------------
// Raporlama onay overlay'i
// ---------------------------------------------------------------

function showReportConfirm(card, comment) {
  if (card.querySelector(".confirm-overlay")) return;
  if (!currentUser) return;

  const overlay = document.createElement("div");
  overlay.className = "confirm-overlay";

  const msg = document.createElement("p");
  msg.textContent = "Bu yorumu raporlamak istediğine emin misin?";

  const buttons = document.createElement("div");
  buttons.className = "confirm-buttons";

  const yesBtn = document.createElement("button");
  yesBtn.className = "confirm-yes";
  yesBtn.style.background = "var(--primary-c)";
  yesBtn.style.color = "#03130d";
  yesBtn.textContent = "Evet, raporla";
  yesBtn.addEventListener("click", async () => {
    yesBtn.disabled = true;
    yesBtn.textContent = "Gönderiliyor…";

    const reportId = `${comment.id}_${currentUser.uid}`;

    try {
      await setDoc(doc(db, "reports", reportId), {
        videoSlug: slug,
        commentId: comment.id,
        commentTextSnapshot: comment.text,
        commentAuthorId: comment.userId,
        reportedBy: currentUser.uid,
        createdAt: serverTimestamp(),
      });
      overlay.remove();
      showToast("Rapor gönderildi.");
      // Raporla butonunu güncelle
      const reportBtn = card.querySelector(".report-btn");
      if (reportBtn) {
        reportBtn.textContent = "✓";
        reportBtn.disabled = true;
        reportBtn.title = "Raporlandı";
      }
    } catch (err) {
      overlay.remove();
      if (err.code === "permission-denied") {
        showToast("Bu yorumu zaten raporlamıştın.");
        const reportBtn = card.querySelector(".report-btn");
        if (reportBtn) {
          reportBtn.textContent = "✓";
          reportBtn.disabled = true;
          reportBtn.title = "Raporlandı";
        }
      } else {
        console.error("Rapor gönderilemedi:", err);
        showToast("Rapor gönderilemedi.");
      }
    }
  });

  const noBtn = document.createElement("button");
  noBtn.className = "confirm-no";
  noBtn.textContent = "Vazgeç";
  noBtn.addEventListener("click", () => overlay.remove());

  buttons.append(noBtn, yesBtn);
  overlay.append(msg, buttons);
  card.appendChild(overlay);
}

// ---------------------------------------------------------------
// Yorum formu
// ---------------------------------------------------------------

function renderCommentForm() {
  commentFormArea.innerHTML = "";

  if (!currentUser) {
    // Giriş yapılmamış
    const prompt = document.createElement("div");
    prompt.className = "comment-login-prompt";

    const link = document.createElement("a");
    link.href = "/giris";
    link.textContent = "Giriş yap";

    prompt.append("Yorum yazmak için ", link, " ");
    commentFormArea.appendChild(prompt);
    return;
  }

  if (currentUserBanned) {
    const prompt = document.createElement("div");
    prompt.className = "comment-login-prompt";
    prompt.textContent = "Hesabınız askıya alındığı için yorum yazamazsınız.";
    commentFormArea.appendChild(prompt);
    return;
  }

  // Form oluştur
  const form = document.createElement("div");
  form.className = "comment-form";

  const textarea = document.createElement("textarea");
  textarea.placeholder = "Yorumunu yaz…";
  textarea.maxLength = 500;

  const footer = document.createElement("div");
  footer.className = "comment-form-footer";

  const charCount = document.createElement("span");
  charCount.className = "comment-char-count";
  charCount.textContent = "0 / 500";

  const submitBtn = document.createElement("button");
  submitBtn.className = "comment-submit-btn";
  submitBtn.textContent = "Gönder";
  submitBtn.disabled = true;

  textarea.addEventListener("input", () => {
    const len = textarea.value.trim().length;
    charCount.textContent = `${len} / 500`;
    charCount.classList.toggle("over", len > 500);
    submitBtn.disabled = len === 0 || len > 500;
  });

  submitBtn.addEventListener("click", async () => {
    const text = textarea.value.trim();
    if (!text || text.length > 500) return;

    submitBtn.disabled = true;
    submitBtn.textContent = "Gönderiliyor…";

    try {
      const docRef = await addDoc(
        collection(db, "videos", slug, "comments"),
        {
          userId: currentUser.uid,
          text,
          createdAt: serverTimestamp(),
        }
      );

      // Yeni yorumu listeye anında ekle (ekstra sorgu yok)
      commentsEmpty.style.display = "none";

      // Username'i çözümle
      await resolveUsername(currentUser.uid);

      const newComment = {
        id: docRef.id,
        userId: currentUser.uid,
        text,
        createdAt: { toDate: () => new Date() }, // Geçici, serverTimestamp henüz çözülmedi
      };

      const card = createCommentCard(newComment);
      // En yeni üstte olduğu için başa ekle
      commentListEl.prepend(card);

      // Formu temizle
      textarea.value = "";
      charCount.textContent = "0 / 500";
      submitBtn.disabled = true;
      submitBtn.textContent = "Gönder";

      showToast("Yorum gönderildi.");
    } catch (err) {
      console.error("Yorum gönderilemedi:", err);
      if (err.code === "permission-denied") {
        showToast("Yorum gönderilemedi. Hesabınız kısıtlanmış olabilir.");
      } else {
        showToast("Yorum gönderilirken bir hata oluştu.");
      }
      submitBtn.disabled = false;
      submitBtn.textContent = "Gönder";
    }
  });

  footer.append(charCount, submitBtn);
  form.append(textarea, footer);
  commentFormArea.appendChild(form);
}

// ---------------------------------------------------------------
// isBanned kontrolü
// ---------------------------------------------------------------

async function checkBanStatus(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      return snap.data().isBanned === true;
    }
  } catch (_) {
    // Okunamazsa ban'lı sayma
  }
  return false;
}

// ---------------------------------------------------------------
// Auth state + başlatma
// ---------------------------------------------------------------

function waitForSlug() {
  return new Promise((resolve) => {
    const check = () => {
      const path = window.location.pathname;
      const s = path.startsWith("/izle/")
        ? decodeURIComponent(path.slice(6))
        : new URLSearchParams(window.location.search).get("slug");
      if (s) return resolve(s);
      setTimeout(check, 50);
    };
    check();
  });
}

async function init() {
  slug = await waitForSlug();

  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    currentUserBanned = false;

    if (user) {
      currentUserBanned = await checkBanStatus(user.uid);
    }

    renderCommentForm();
    await loadComments();
  });
}

init();
