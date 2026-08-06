import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { logoutUser, deleteAccount } from "./auth.js";
import "./banner.js";

const authStatus = document.getElementById("auth-status");

// ---------------------------------------------------------------
// Giriş yapılmamış
// ---------------------------------------------------------------

function renderLoggedOut() {
  authStatus.innerHTML = "";
  const link = document.createElement("a");
  link.href = "/giris";
  link.textContent = "Giriş Yap";
  authStatus.appendChild(link);

  // Paneli kaldır (varsa)
  const existing = document.getElementById("profile-panel-overlay");
  if (existing) existing.remove();
}

// ---------------------------------------------------------------
// Giriş yapılmış
// ---------------------------------------------------------------

function renderLoggedIn(displayName, email) {
  authStatus.innerHTML = "";

  // Kullanıcı adı butonu (paneli açar)
  const usernameBtn = document.createElement("button");
  usernameBtn.className = "nav-username-btn";
  usernameBtn.textContent = displayName;
  usernameBtn.addEventListener("click", () => openProfilePanel());

  // Çıkış butonu
  const logoutBtn = document.createElement("button");
  logoutBtn.innerHTML =
    '<span class="material-symbols-outlined" style="font-size:18px">logout</span><span class="logout-text"> Çıkış</span>';
  logoutBtn.addEventListener("click", async () => {
    try { await logoutUser(); } catch (_) {}
    window.location.href = "/";
  });

  authStatus.append(usernameBtn, logoutBtn);

  // Profil panelini oluştur (DOM'a ekle ama gizli)
  createProfilePanel(displayName, email);
}

// ---------------------------------------------------------------
// Profil paneli
// ---------------------------------------------------------------

function createProfilePanel(displayName, email) {
  // Zaten varsa tekrar oluşturma
  if (document.getElementById("profile-panel-overlay")) return;

  // Overlay (arka plan karartma)
  const overlay = document.createElement("div");
  overlay.id = "profile-panel-overlay";
  overlay.className = "profile-overlay";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeProfilePanel();
  });

  // Panel
  const panel = document.createElement("div");
  panel.className = "profile-panel";

  // Başlık
  const header = document.createElement("div");
  header.className = "profile-panel-header";

  const title = document.createElement("span");
  title.className = "profile-panel-title";
  title.textContent = "Hesap";

  const closeBtn = document.createElement("button");
  closeBtn.className = "profile-panel-close";
  closeBtn.innerHTML = '<span class="material-symbols-outlined">close</span>';
  closeBtn.addEventListener("click", closeProfilePanel);

  header.append(title, closeBtn);

  // Kullanıcı bilgileri
  const info = document.createElement("div");
  info.className = "profile-info";

  const nameEl = document.createElement("div");
  nameEl.className = "profile-name";
  nameEl.textContent = displayName;

  const emailEl = document.createElement("div");
  emailEl.className = "profile-email";
  emailEl.textContent = email;

  info.append(nameEl, emailEl);

  // Hesabı sil butonu
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "profile-delete-btn";
  deleteBtn.textContent = "Hesabımı Sil";
  deleteBtn.addEventListener("click", () => showDeleteConfirm(panel, deleteBtn));

  // Mesaj alanı
  const msg = document.createElement("p");
  msg.className = "profile-message";
  msg.id = "profile-message";

  panel.append(header, info, deleteBtn, msg);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

function openProfilePanel() {
  const overlay = document.getElementById("profile-panel-overlay");
  if (overlay) overlay.classList.add("open");
}

function closeProfilePanel() {
  const overlay = document.getElementById("profile-panel-overlay");
  if (overlay) overlay.classList.remove("open");
}

// ---------------------------------------------------------------
// Hesap silme onayı
// ---------------------------------------------------------------

function showDeleteConfirm(panel, deleteBtn) {
  // Zaten onay varsa tekrar ekleme
  if (panel.querySelector(".profile-confirm")) return;

  deleteBtn.style.display = "none";

  const confirm = document.createElement("div");
  confirm.className = "profile-confirm";

  const warning = document.createElement("p");
  warning.className = "profile-confirm-text";
  warning.textContent = "Hesabın kalıcı olarak silinecek. Bu işlem geri alınamaz. Yorumların kalır ama kullanıcı adın \"Silinmiş Kullanıcı\" olarak görünür.";

  // Şifre doğrulaması: Firebase hesap silme için son girişin taze olmasını
  // istiyor. Şifreyi burada alıp yeniden kimlik doğrulaması yapmazsak,
  // silme işlemi yarıda kalıp hesabı bozuk bırakabiliyor.
  const passLabel = document.createElement("label");
  passLabel.className = "profile-confirm-label";
  passLabel.textContent = "Onaylamak için şifreni gir";
  passLabel.htmlFor = "profile-delete-password";

  const passInput = document.createElement("input");
  passInput.type = "password";
  passInput.id = "profile-delete-password";
  passInput.className = "profile-confirm-input";
  passInput.autocomplete = "current-password";
  passInput.placeholder = "Şifre";

  const buttons = document.createElement("div");
  buttons.className = "profile-confirm-buttons";

  const yesBtn = document.createElement("button");
  yesBtn.className = "confirm-yes";
  yesBtn.textContent = "Evet, Hesabımı Sil";
  yesBtn.disabled = true;

  function hataGoster(metin) {
    const msg = document.getElementById("profile-message");
    if (msg) {
      msg.textContent = metin;
      msg.style.color = "var(--danger)";
    }
  }

  passInput.addEventListener("input", () => {
    yesBtn.disabled = passInput.value.length === 0;
    const msg = document.getElementById("profile-message");
    if (msg) msg.textContent = "";
  });

  async function silmeyiCalistir() {
    if (yesBtn.disabled) return;
    yesBtn.disabled = true;
    yesBtn.textContent = "Siliniyor…";
    noBtn.disabled = true;
    passInput.disabled = true;
    try {
      await deleteAccount(passInput.value);
      window.location.href = "/";
    } catch (err) {
      hataGoster(err.message);
      yesBtn.textContent = "Evet, Hesabımı Sil";
      yesBtn.disabled = passInput.value.length === 0;
      noBtn.disabled = false;
      passInput.disabled = false;
      passInput.focus();
      passInput.select();
    }
  }

  yesBtn.addEventListener("click", silmeyiCalistir);
  passInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") silmeyiCalistir();
  });

  const noBtn = document.createElement("button");
  noBtn.className = "confirm-no";
  noBtn.textContent = "Vazgeç";
  noBtn.addEventListener("click", () => {
    confirm.remove();
    deleteBtn.style.display = "";
    const msg = document.getElementById("profile-message");
    if (msg) msg.textContent = "";
  });

  buttons.append(noBtn, yesBtn);
  confirm.append(warning, passLabel, passInput, buttons);
  panel.appendChild(confirm);

  passInput.focus();
}

// ---------------------------------------------------------------
// Auth state listener
// ---------------------------------------------------------------

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    renderLoggedOut();
    return;
  }

  let displayName = user.email;
  let email = user.email;
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      displayName = snap.data().username;
    }
  } catch (_) {}

  renderLoggedIn(displayName, email);
});
