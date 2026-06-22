import { registerUser, loginUser, resetPassword } from "./auth.js";

// ---- Sekme geçişi ----
const tabButtons = document.querySelectorAll(".tab-btn");
const panels = document.querySelectorAll(".tab-panel");

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabButtons.forEach((b) => b.classList.remove("active"));
    panels.forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`${btn.dataset.tab}-form`).classList.add("active");
  });
});

function showMessage(elementId, text, isError = true) {
  const el = document.getElementById(elementId);
  el.textContent = text;
  el.classList.toggle("error", isError);
  el.classList.toggle("success", !isError);
}

// ---- Giriş ----
document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  try {
    await loginUser(email, password);
    window.location.href = "index.html";
  } catch (err) {
    showMessage("login-message", err.message);
  }
});

// ---- Kayıt ----
document.getElementById("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("register-username").value.trim();
  const email = document.getElementById("register-email").value.trim();
  const password = document.getElementById("register-password").value;
  try {
    await registerUser(email, password, username);
    window.location.href = "index.html";
  } catch (err) {
    showMessage("register-message", err.message);
  }
});

// ---- Şifre sıfırlama ----
document.getElementById("reset-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("reset-email").value.trim();
  try {
    await resetPassword(email);
    showMessage("reset-message", "Şifre sıfırlama linki e-postana gönderildi.", false);
  } catch (err) {
    showMessage("reset-message", err.message);
  }
});
