// Firebase Console > Project Settings > General > "Your apps" altında bir Web app
// eklemediysen önce onu yap (</> simgesi), sonra buradaki config'i kopyala.
//
// Bu bilgiler GİZLİ DEĞİL - herkese açık bir web sitesinde görünmeleri normal.
// Güvenliği sağlayan şey bu dosya değil, firestore.rules dosyası.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCZHYqSlIqvnQl_1uEKd5oXFgTr4_VR9x4",
  authDomain: "ask-memnu.firebaseapp.com",
  projectId: "ask-memnu",
  storageBucket: "ask-memnu.firebasestorage.app",
  messagingSenderId: "887353101620",
  appId: "1:887353101620:web:b6f758ed39aeced014e961",
  measurementId: "G-Q6YMQK9DNZ"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
