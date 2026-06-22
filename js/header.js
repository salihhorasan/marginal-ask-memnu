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
  // ÖNEMLİ: username "esnek" formatta olduğu için (özel karakter içerebilir),
  // burada innerHTML değil textContent kullanıyoruz - XSS riski olmasın diye.
  authStatus.innerHTML = "";

  const greeting = document.createElement("span");
  greeting.textContent = `Merhaba, ${displayName}`;

  const logoutBtn = document.createElement("button");
  logoutBtn.textContent = "Çıkış Yap";
  logoutBtn.addEventListener("click", async () => {
    try {
      await logoutUser();
    } catch (_) {
      // Çıkış başarısız olsa bile ana sayfaya yönlendir
    }
    window.location.href = "index.html";
  });

  authStatus.append(greeting, logoutBtn);
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
  } catch (err) {
    // Profil okunamazsa sessizce email göster, sayfayı bozma
  }

  renderLoggedIn(displayName);
});
