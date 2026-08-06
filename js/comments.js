import { auth, db } from "./firebase-config.js";
import { getCurrentSlug } from "./video-detail.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
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
let currentUser = null;              // Firebase Auth user
let currentUserBanned = false;       // isBanned durumu
let banDurumuKontrolEdildi = false;  // bu oturumda users/{uid} okundu mu
let slug = null;                     // Mevcut video slug'ı
const usernameCache = new Map();     // uid → displayUsername önbelleği (bellek)

// --- Sayfalama ---
const SAYFA_BOYUTU = 20;
let sonGorunenDoc = null;    // startAfter cursor'ı
let dahaVar = false;         // sunucuda daha yorum var mı
let yukleniyor = false;      // "daha fazla"ya çift tıklamayı engelle
// onAuthStateChanged birden çok kez tetiklenebilir. İki eşzamanlı tam yükleme
// listeyi çiftleyebilir; her yüklemeye sıra numarası verip eskisini iptal ediyoruz.
let yuklemeSayaci = 0;

// --- Username önbelleği (localStorage) ---
// Bellekteki Map sayfa yenilenince sıfırlanıyordu, yani her açılışta her
// yorumcu için tekrar sorgu atılıyordu. Kalıcı önbellek bunu gün başına indirir.
//
// TTL neden 6 saat: kullanıcı hesabını silince "Silinmiş Kullanıcı" görünmeli.
// Önbellek ne kadar uzun yaşarsa, silinen adın başkalarının tarayıcısında
// kalma süresi o kadar uzar. 6 saat, seri önbelleğiyle de aynı süre.
const USERNAME_CACHE_KEY = "username_cache";
const USERNAME_CACHE_TTL = 6 * 60 * 60 * 1000;

function usernameCacheYukle() {
  try {
    const raw = localStorage.getItem(USERNAME_CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed?.updatedAt || Date.now() - parsed.updatedAt > USERNAME_CACHE_TTL) {
      localStorage.removeItem(USERNAME_CACHE_KEY);
      return;
    }
    for (const [uid, ad] of Object.entries(parsed.map || {})) {
      usernameCache.set(uid, ad);
    }
  } catch (_) {
    // Bozuk kayıt — yok say
  }
}

function usernameCacheYaz() {
  try {
    localStorage.setItem(USERNAME_CACHE_KEY, JSON.stringify({
      updatedAt: Date.now(),
      map: Object.fromEntries(usernameCache),
    }));
  } catch (_) {
    // Kota dolu veya erişilemez — önbelleksiz devam et
  }
}

usernameCacheYukle();

// Footer'daki "Sıfırla" butonu seri önbelleğini temizlerken bunu da temizlesin
window.addEventListener("series-cache-cleared", () => {
  usernameCache.clear();
  try { localStorage.removeItem(USERNAME_CACHE_KEY); } catch (_) {}
});

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
    // Ağ/izin hatası: sonucu ÖNBELLEĞE ALMA. Geçici bir hata yüzünden
    // gerçek kullanıcıyı 6 saat boyunca "Silinmiş" göstermek istemeyiz.
    console.error("Username çözümlenemedi:", err);
    return "Silinmiş Kullanıcı";
  }

  // Sorgu başarılı ama kayıt yok → kullanıcı gerçekten silinmiş, önbelleklenebilir
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

/**
 * Yorumları sayfa sayfa yükle.
 *
 * Eskiden bir videodaki BÜTÜN yorumlar tek seferde çekiliyordu — 400 yorumlu
 * bir video her açılışta 400 okuma demekti. Artık 20'şerli sayfalar hâlinde,
 * kullanıcı istedikçe.
 *
 * @param {boolean} devam  true ise cursor'dan sonrasını ekler, false ise baştan yükler
 */
async function loadComments(devam = false) {
  if (!slug) return;
  if (devam && yukleniyor) return;

  const benimSayacim = ++yuklemeSayaci;
  yukleniyor = true;

  if (!devam) {
    commentListEl.innerHTML = "";
    sonGorunenDoc = null;
    dahaVar = false;
  }

  const coll = collection(db, "videos", slug, "comments");
  const kisitlar = [orderBy("createdAt", "desc")];
  if (devam && sonGorunenDoc) kisitlar.push(startAfter(sonGorunenDoc));
  kisitlar.push(limit(SAYFA_BOYUTU));

  let snapshot;
  try {
    snapshot = await getDocs(query(coll, ...kisitlar));
  } catch (err) {
    console.error("Yorumlar yüklenemedi:", err);
    if (benimSayacim !== yuklemeSayaci) return;   // daha yeni bir yükleme var
    yukleniyor = false;
    if (devam) {
      showToast("Yorumlar yüklenemedi.");
      renderDahaFazlaBtn();
    } else {
      commentListEl.innerHTML =
        '<p class="empty-state">Yorumlar yüklenirken bir hata oluştu.</p>';
    }
    return;
  }

  // Bu yükleme başlarken daha yenisi başlamışsa sonucu at — liste çiftlenmesin
  if (benimSayacim !== yuklemeSayaci) return;

  // İlk sayfa boşsa "henüz yorum yok"
  if (snapshot.empty && !devam) {
    commentsEmpty.style.display = "block";
    commentListEl.appendChild(commentsEmpty);
    yukleniyor = false;
    return;
  }

  commentsEmpty.style.display = "none";

  // Cursor'ı ve "daha var mı" bilgisini güncelle.
  // Tam sayfa geldiyse muhtemelen devamı var; eksik geldiyse son sayfadayız.
  if (snapshot.docs.length > 0) {
    sonGorunenDoc = snapshot.docs[snapshot.docs.length - 1];
  }
  dahaVar = snapshot.docs.length === SAYFA_BOYUTU;

  const comments = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

  // Benzersiz uid'leri topla, username'leri paralel çözümle.
  // Önbellekte olanlar için sorgu atılmaz.
  const uniqueUids = [...new Set(comments.map((c) => c.userId))];
  const cozumlenecek = uniqueUids.filter((uid) => !usernameCache.has(uid));
  if (cozumlenecek.length > 0) {
    await Promise.all(cozumlenecek.map(resolveUsername));
    usernameCacheYaz();
    // Username çözümlemesi de asenkron — bu arada yeni yükleme başlamış olabilir
    if (benimSayacim !== yuklemeSayaci) return;
  }

  comments.forEach((comment) => {
    commentListEl.appendChild(createCommentCard(comment));
  });

  yukleniyor = false;
  renderDahaFazlaBtn();
}

/** Listenin altındaki "Daha fazla yorum göster" butonunu tazele. */
function renderDahaFazlaBtn() {
  const eski = commentListEl.querySelector(".comment-more-btn");
  if (eski) eski.remove();

  if (!dahaVar) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "comment-more-btn";
  btn.textContent = "Daha Fazla Yorum Göster";
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Yükleniyor…";
    await loadComments(true);
  });

  commentListEl.appendChild(btn);
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

      // Liste boş kaldıysa: sunucuda başka sayfa varsa onu getir,
      // gerçekten hiç yorum kalmadıysa empty state göster.
      if (commentListEl.querySelectorAll(".comment-card").length === 0) {
        if (dahaVar) {
          await loadComments();
        } else {
          commentsEmpty.style.display = "block";
          commentListEl.appendChild(commentsEmpty);
        }
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
// Yorum yazma modalı
// ---------------------------------------------------------------
//
// Eskiden yorum formu sayfa yüklenirken doğrudan basılıyordu ve bunun için
// her açılışta users/{uid} okunup ban durumu kontrol ediliyordu. Bu, yorum
// yazmayacak kullanıcılara da maliyet çıkarıyordu.
//
// Yeni akış: sayfada sadece bir buton var. Ban kontrolü butona basılınca,
// yani kullanıcı gerçekten yorum yazmak istediğinde yapılıyor ve sonuç
// oturum boyunca hatırlanıyor. Form bir modal içinde açılıyor.

let modalOverlay = null;         // açık modalın overlay'i
let oncekiOdak = null;           // modal kapanınca odağın döneceği eleman

function closeCommentModal() {
  if (!modalOverlay) return;
  const overlay = modalOverlay;
  modalOverlay = null;

  overlay.classList.remove("open");
  document.body.classList.remove("comment-modal-open");
  document.removeEventListener("keydown", onModalKeydown);

  // Kapanma animasyonu bitince DOM'dan kaldır
  setTimeout(() => overlay.remove(), 250);

  if (oncekiOdak && document.contains(oncekiOdak)) oncekiOdak.focus();
  oncekiOdak = null;
}

function onModalKeydown(e) {
  if (e.key === "Escape") closeCommentModal();
}

function openCommentModal(baslik, icerikEl) {
  closeCommentModal();
  oncekiOdak = document.activeElement;

  const overlay = document.createElement("div");
  overlay.className = "comment-modal-overlay";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeCommentModal();
  });

  const modal = document.createElement("div");
  modal.className = "comment-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", baslik);

  const header = document.createElement("div");
  header.className = "comment-modal-header";

  const title = document.createElement("span");
  title.className = "comment-modal-title";
  title.textContent = baslik;

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "comment-modal-close";
  closeBtn.setAttribute("aria-label", "Kapat");
  closeBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
  closeBtn.addEventListener("click", closeCommentModal);

  header.append(title, closeBtn);

  const body = document.createElement("div");
  body.className = "comment-modal-body";
  body.appendChild(icerikEl);

  modal.append(header, body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  document.body.classList.add("comment-modal-open");
  document.addEventListener("keydown", onModalKeydown);

  modalOverlay = overlay;

  // Bir sonraki frame'de aç ki geçiş animasyonu çalışsın
  requestAnimationFrame(() => {
    overlay.classList.add("open");
    const ta = modal.querySelector("textarea");
    if (ta) ta.focus();
  });
}

// ---------------------------------------------------------------
// Modal içerikleri
// ---------------------------------------------------------------

/** Giriş yapılmamış */
function buildLoginNotice() {
  const wrap = document.createElement("div");
  wrap.className = "comment-notice";

  const p = document.createElement("p");
  p.className = "comment-notice-text";
  p.textContent = "Yorum yazabilmek için giriş yapman gerekiyor.";

  const link = document.createElement("a");
  link.className = "comment-notice-action";
  link.href = "/giris";
  link.textContent = "Giriş Yap";

  wrap.append(p, link);
  return wrap;
}

/** Banlı kullanıcı */
function buildBannedNotice() {
  const wrap = document.createElement("div");
  wrap.className = "comment-notice";

  const p = document.createElement("p");
  p.className = "comment-notice-text";
  p.textContent = "Hesabın askıya alındığı için yorum yazamazsın.";

  const sub = document.createElement("p");
  sub.className = "comment-notice-sub";
  sub.textContent = "Bunun bir hata olduğunu düşünüyorsan site sahibiyle iletişime geçebilirsin.";

  wrap.append(p, sub);
  return wrap;
}

/** Yorum yazma formu */
function buildCommentForm() {
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

      // Username'i çözümle (önbellekte yoksa sorgular, sonra kalıcı yazar)
      if (!usernameCache.has(currentUser.uid)) {
        await resolveUsername(currentUser.uid);
        usernameCacheYaz();
      }

      const newComment = {
        id: docRef.id,
        userId: currentUser.uid,
        text,
        createdAt: { toDate: () => new Date() }, // Geçici, serverTimestamp henüz çözülmedi
      };

      const card = createCommentCard(newComment);
      // En yeni üstte olduğu için başa ekle
      commentListEl.prepend(card);

      closeCommentModal();
      showToast("Yorum gönderildi.");
    } catch (err) {
      console.error("Yorum gönderilemedi:", err);
      if (err.code === "permission-denied") {
        // Rules reddetti — sayfa açıldığından beri banlanmış olabilir.
        // Bir sonraki denemede taze kontrol yapılsın diye önbelleği sıfırla.
        banDurumuKontrolEdildi = false;
        showToast("Yorum gönderilemedi. Hesabın kısıtlanmış olabilir.");
      } else {
        showToast("Yorum gönderilirken bir hata oluştu.");
      }
      submitBtn.disabled = false;
      submitBtn.textContent = "Gönder";
    }
  });

  footer.append(charCount, submitBtn);
  form.append(textarea, footer);
  return form;
}

// ---------------------------------------------------------------
// "Yorum Yaz" butonu — ban kontrolü buraya ertelendi
// ---------------------------------------------------------------

function renderCommentTrigger() {
  commentFormArea.innerHTML = "";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "comment-trigger-btn";

  const icon = document.createElement("span");
  icon.className = "material-symbols-outlined";
  icon.textContent = "edit";

  const label = document.createElement("span");
  label.textContent = "Yorum Yaz";

  btn.append(icon, label);
  btn.addEventListener("click", () => onTriggerClick(btn, label));
  commentFormArea.appendChild(btn);
}

async function onTriggerClick(btn, label) {
  // Giriş yapılmamışsa Firestore'a gitmeye gerek yok, senkron biliyoruz
  if (!currentUser) {
    openCommentModal("Giriş Gerekli", buildLoginNotice());
    return;
  }

  // Ban durumu bu oturumda daha önce kontrol edilmediyse şimdi kontrol et.
  // Sonuç hatırlanır — kullanıcı modalı kapatıp tekrar açarsa yeniden okunmaz.
  if (!banDurumuKontrolEdildi) {
    btn.disabled = true;
    const eskiMetin = label.textContent;
    label.textContent = "Kontrol ediliyor…";
    try {
      currentUserBanned = await checkBanStatus(currentUser.uid);
      banDurumuKontrolEdildi = true;
    } finally {
      label.textContent = eskiMetin;
      btn.disabled = false;
    }
  }

  if (currentUserBanned) {
    openCommentModal("Yorum Yazılamıyor", buildBannedNotice());
  } else {
    openCommentModal("Yorum Yaz", buildCommentForm());
  }
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
    // Okunamazsa ban'lı sayma — nihai karar zaten rules'ta veriliyor
  }
  return false;
}

// ---------------------------------------------------------------
// Auth state + başlatma
// ---------------------------------------------------------------

async function init() {
  slug = getCurrentSlug();

  // Slug yoksa video da yok; yorum bölümünü hiç başlatma.
  if (!slug) return;

  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    currentUserBanned = false;
    banDurumuKontrolEdildi = false;   // kullanıcı değişti, önbelleği sıfırla
    closeCommentModal();              // açık modal varsa kapat

    renderCommentTrigger();
    await loadComments();
  });
}

init();
