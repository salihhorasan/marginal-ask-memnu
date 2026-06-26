import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  deleteUser,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  doc,
  getDoc,
  deleteDoc,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// ---------------------------------------------------------------
// Firebase hata kodlarını Türkçe mesaja çevir
// ---------------------------------------------------------------

function translateError(code) {
  const map = {
    "auth/email-already-in-use": "Bu e-posta adresi zaten kayıtlı.",
    "auth/invalid-email": "Geçersiz e-posta adresi.",
    "auth/weak-password": "Şifre en az 6 karakter olmalı.",
    "auth/user-not-found": "Bu e-posta ile kayıtlı bir kullanıcı bulunamadı.",
    "auth/wrong-password": "E-posta veya şifre hatalı.",
    "auth/invalid-credential": "E-posta veya şifre hatalı.",
    "auth/user-disabled": "Bu hesap askıya alınmış.",
    "auth/too-many-requests": "Çok fazla deneme yapıldı, lütfen biraz sonra tekrar dene.",
  };
  return map[code] || "Bir hata oluştu, lütfen tekrar dene.";
}

// Security rules ile aynı kural: boşluk ve "/" yasak, 1-30 karakter
function isValidUsername(name) {
  return name.length >= 1 && name.length <= 30 && !/[\s/]/.test(name);
}

// ---------------------------------------------------------------
// Kayıt: Auth hesabı + Firestore profili (atomik, başarısızlıkta geri alınır)
// ---------------------------------------------------------------

export async function registerUser(email, password, username) {
  if (!isValidUsername(username)) {
    throw new Error("Kullanıcı adı boşluk veya '/' içeremez, 1-30 karakter olmalı.");
  }

  const usernameLower = username.toLowerCase();
  let credential;

  try {
    credential = await createUserWithEmailAndPassword(auth, email, password);
  } catch (err) {
    throw new Error(translateError(err.code));
  }

  const uid = credential.user.uid;

  try {
    await runTransaction(db, async (transaction) => {
      const usernameRef = doc(db, "usernames", usernameLower);
      const existing = await transaction.get(usernameRef);
      if (existing.exists()) {
        throw new Error("USERNAME_TAKEN");
      }
      transaction.set(usernameRef, { uid, displayUsername: username });
      transaction.set(doc(db, "users", uid), {
        email,
        username,
        createdAt: serverTimestamp(),
        isBanned: false,
        bannedAt: null,
        banReason: null,
      });
    });
  } catch (err) {
    try {
      await deleteUser(credential.user);
    } catch (_deleteErr) {
      // Temizlik başarısız olursa bile orijinal hatayı iletmeye devam et.
      // Auth'ta sahipsiz hesap kalabilir - admin SDK ile temizlenmeli.
    }
    if (err.message === "USERNAME_TAKEN") {
      throw new Error("Bu kullanıcı adı zaten alınmış. Başka bir ad dene.");
    }
    throw new Error("Kayıt tamamlanamadı, lütfen tekrar dene.");
  }

  return uid;
}

// ---------------------------------------------------------------
// Giriş
// ---------------------------------------------------------------

export async function loginUser(email, password) {
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    throw new Error(translateError(err.code));
  }
}

// ---------------------------------------------------------------
// Çıkış (ileride header/nav'da kullanılacak)
// ---------------------------------------------------------------

export async function logoutUser() {
  await signOut(auth);
}

// ---------------------------------------------------------------
// Şifre sıfırlama
// ---------------------------------------------------------------

export async function resetPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (err) {
    throw new Error(translateError(err.code));
  }
}

// ---------------------------------------------------------------
// Hesap silme (kullanıcı kendi hesabını siler)
// ---------------------------------------------------------------

export async function deleteAccount() {
  const user = auth.currentUser;
  if (!user) throw new Error("Giriş yapmış bir kullanıcı bulunamadı.");

  const uid = user.uid;

  // 1) Kullanıcının username'ini bul (usernames dokümanını silmek için)
  try {
    const userSnap = await getDoc(doc(db, "users", uid));
    if (userSnap.exists()) {
      const username = userSnap.data().username;
      if (username) {
        const usernameLower = username.toLowerCase();
        // 2) usernames dokümanını sil
        try {
          await deleteDoc(doc(db, "usernames", usernameLower));
        } catch (_) {
          // Silinemezse devam et — kritik değil
        }
      }
    }
  } catch (_) {
    // users okunamazsa devam et
  }

  // 3) users dokümanını sil
  try {
    await deleteDoc(doc(db, "users", uid));
  } catch (_) {
    // Silinemezse devam et
  }

  // 4) Firebase Auth hesabını sil
  try {
    await deleteUser(user);
  } catch (err) {
    if (err.code === "auth/requires-recent-login") {
      throw new Error("Güvenlik nedeniyle hesabınızı silmek için tekrar giriş yapmanız gerekiyor. Çıkış yapıp tekrar giriş yaptıktan sonra deneyin.");
    }
    throw new Error("Hesap silinirken bir hata oluştu.");
  }
}