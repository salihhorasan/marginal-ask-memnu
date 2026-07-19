import { db } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// Hangi sayfada olduğumuzu belirleyen yardımcı fonksiyon
function getCurrentPageType() {
  const path = window.location.pathname;
  if (path === "/" || path === "/index.html") return "home";
  if (path.startsWith("/izle/") || path.startsWith("/video.html")) return "video";
  if (path.startsWith("/hukuki")) return "legal";
  if (path.startsWith("/giris") || path.startsWith("/auth")) return "auth";
  return "other";
}

const BANNER_CACHE_KEY = "banner_config_cache";
const BANNER_CACHE_TTL = 1 * 60 * 60 * 1000; // 1 saat (ms)

function getCachedBanner() {
  try {
    const raw = localStorage.getItem(BANNER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.updatedAt > BANNER_CACHE_TTL) return null;
    return parsed.config;
  } catch (_) {
    return null;
  }
}

function setCachedBanner(config) {
  try {
    localStorage.setItem(BANNER_CACHE_KEY, JSON.stringify({
      updatedAt: Date.now(),
      config,
    }));
  } catch (_) {}
}

async function initBanner() {
  try {
    let bannerConfig = getCachedBanner();
    
    // Cache'de yoksa veya süresi dolmuşsa Firestore'dan çek
    if (bannerConfig === null) {
      const snap = await getDoc(doc(db, "settings", "global"));
      if (snap.exists()) {
        const data = snap.data();
        bannerConfig = data.bannerConfig || false; // false = boş banner
      } else {
        bannerConfig = false;
      }
      // Firestore'dan gelen veriyi (veya boş olduğunu) 1 saat cache'le
      setCachedBanner(bannerConfig);
    }

    if (!bannerConfig) return;

    const { message, targetPages, isActive } = bannerConfig;

    // Eğer banner pasifse veya mesaj yoksa çık
    if (isActive === false || !message || message.trim() === "") return;

    // Hedef sayfaları kontrol et ('all' ise her yerde, dizi ise sayfayı içeriyor mu bak)
    const currentPage = getCurrentPageType();
    const isTargeted = targetPages === "all" || (Array.isArray(targetPages) && targetPages.includes(currentPage));

    if (!isTargeted) return;

    // Banner'ı oluştur ve DOM'a ekle
    const banner = document.createElement("div");
    banner.id = "dynamic-banner";
    
    const textSpan = document.createElement("span");
    textSpan.className = "banner-text";
    textSpan.textContent = message;
    
    banner.appendChild(textSpan);
    
    // Header'ın hemen altına (sayfa içeriğinin en üstüne) ekle
    const topbar = document.querySelector("nav.topbar");
    if (topbar && topbar.nextSibling) {
      topbar.parentNode.insertBefore(banner, topbar.nextSibling);
    } else {
      document.body.prepend(banner);
    }

  } catch (err) {
    console.error("Banner yüklenirken hata oluştu:", err);
  }
}

initBanner();
