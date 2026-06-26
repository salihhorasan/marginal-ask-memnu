import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { logoutUser } from "./auth.js";

const authStatus = document.getElementById("auth-status");

function renderLoggedOut() {
  authStatus.innerHTML = "";

  const link = document.createElement("a");
  link.href = "auth.html";
  link.textContent = "Giriş Yap";
  authStatus.appendChild(link);
}

function renderLoggedIn(displayName) {
  authStatus.innerHTML = "";

  const username = document.createElement("span");
  username.className = "nav-username";
  username.textContent = displayName;

  const logoutBtn = document.createElement("button");
  logoutBtn.innerHTML =
    '<span class="material-symbols-outlined" style="font-size:18px">logout</span><span class="logout-text"> Çıkış</span>';
  logoutBtn.addEventListener("click", async () => {
    try {
      await logoutUser();
    } catch (_) {
      // Çıkış başarısız olsa bile devam et
    }
    window.location.href = "index.html";
  });

  authStatus.append(username, logoutBtn);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    renderLoggedOut();
    return;
  }

  let displayName = user.email;
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      displayName = snap.data().username;
    }
  } catch (_) {
    // Profil okunamazsa email göster
  }

  renderLoggedIn(displayName);
});