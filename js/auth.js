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
