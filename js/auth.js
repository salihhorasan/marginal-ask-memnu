import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  reauthenticateWithCredential,
  EmailAuthProvider,
  deleteUser,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
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

/**
 * Hesabı kalıcı olarak sil.
 *
 * ESKİ AKIŞTAKİ HATA:
 * Sıra "usernames sil → users sil → Auth sil" idi. Son adım
 * `auth/requires-recent-login` ile patlayabiliyordu — Firebase, hesap silme
 * gibi hassas işlemler için son girişin taze olmasını istiyor. Patladığında
 * Firestore belgeleri çoktan silinmiş oluyordu ve kullanıcı yarım silinmiş
 * hâlde kalıyordu: giriş yapabiliyor ama yorum yazamıyor (rules'taki
 * isNotBanned() var olmayan users belgesini okuyamayıp reddediyor) ve
 * sebebini asla anlayamıyor.
 *
 * YENİ AKIŞ — iki katmanlı savunma:
 * 1) Önce şifreyle yeniden kimlik doğrulama. Bu, son adımın patlama
 *    ihtimalini pratikte sıfırlıyor.
 * 2) Buna rağmen patlarsa Firestore belgeleri geri yazılıyor. Kullanıcı
 *    çalışır hâlde kalıyor.
 *
 * @param {string} password  Kullanıcının mevcut şifresi
 */
export async function deleteAccount(password) {
  const user = auth.currentUser;
  if (!user) throw new Error("Giriş yapmış bir kullanıcı bulunamadı.");
  if (!password) throw new Error("Devam etmek için şifreni gir.");

  const uid = user.uid;

  // --- 1) Yeniden kimlik doğrulama ---
  try {
    const credential = EmailAuthProvider.credential(user.email, password);
    await reauthenticateWithCredential(user, credential);
  } catch (err) {
    if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
      throw new Error("Şifre hatalı.");
    }
    if (err.code === "auth/too-many-requests") {
      throw new Error("Çok fazla deneme yapıldı, lütfen biraz sonra tekrar dene.");
    }
    throw new Error(translateError(err.code));
  }

  // --- 2) Geri yükleme için mevcut veriyi hatırla ---
  let userData = null;
  let usernameLower = null;
  try {
    const userSnap = await getDoc(doc(db, "users", uid));
    if (userSnap.exists()) {
      userData = userSnap.data();
      if (userData.username) usernameLower = userData.username.toLowerCase();
    }
  } catch (_) {
    // users okunamazsa geri yükleme yapamayız ama silmeye devam edebiliriz
  }

  // --- 3) Firestore belgelerini sil ---
  let usernameSilindi = false;
  let userSilindi = false;

  if (usernameLower) {
    try {
      await deleteDoc(doc(db, "usernames", usernameLower));
      usernameSilindi = true;
    } catch (_) {
      // Silinemezse devam et — kritik değil
    }
  }

  try {
    await deleteDoc(doc(db, "users", uid));
    userSilindi = true;
  } catch (_) {
    // Silinemezse devam et
  }

  // --- 4) Auth hesabını sil ---
  try {
    await deleteUser(user);
  } catch (err) {
    // Buraya normalde hiç girilmemeli (1. adım tazeliği garantiledi).
    // Girilirse kullanıcıyı yarım silinmiş bırakmamak için geri al.
    await geriYukle(uid, userData, usernameLower, usernameSilindi, userSilindi);

    if (err.code === "auth/requires-recent-login") {
      throw new Error("Oturum doğrulaması zaman aşımına uğradı. Lütfen tekrar dene.");
    }
    throw new Error("Hesap silinemedi. Hesabın olduğu gibi duruyor, tekrar deneyebilirsin.");
  }
}

/**
 * Auth silme başarısız olursa Firestore belgelerini geri yaz.
 *
 * Not: users belgesindeki createdAt geri yüklenemiyor — rules
 * `createdAt == request.time` şartı koyuyor, yani kayıt tarihi bugüne
 * sıfırlanıyor. Hesabın tamamen kilitlenmesine kıyasla kabul edilebilir.
 */
async function geriYukle(uid, userData, usernameLower, usernameSilindi, userSilindi) {
  if (usernameSilindi && usernameLower && userData?.username) {
    try {
      await setDoc(doc(db, "usernames", usernameLower), {
        uid,
        displayUsername: userData.username,
      });
    } catch (_) {}
  }

  if (userSilindi && userData) {
    try {
      await setDoc(doc(db, "users", uid), {
        email: userData.email,
        username: userData.username,
        createdAt: serverTimestamp(),
        isBanned: false,
        bannedAt: null,
        banReason: null,
      });
    } catch (_) {}
  }
}