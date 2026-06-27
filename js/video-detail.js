import { db } from "./firebase-config.js";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  getDocs,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// ---------------------------------------------------------------
// DOM referansları
// ---------------------------------------------------------------
const titleEl       = document.getElementById("video-title");
const descEl        = document.getElementById("video-desc");
const playerShell   = document.getElementById("player-shell");
const videoPlayer   = document.getElementById("video-player");
const navBar        = document.getElementById("nav-bar");
const railTrack     = document.getElementById("episode-rail-track");
const railContainer = document.getElementById("episode-rail");
const momentList    = document.getElementById("moment-list");
const momentsEmpty  = document.getElementById("moments-empty");

// ---------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------

function getSlugFromUrl() {
  // Temiz URL: /izle/slug-name
  const path = window.location.pathname;
  if (path.startsWith("/izle/")) {
    return decodeURIComponent(path.slice(6));
  }
  // Fallback: ?slug=slug-name
  return new URLSearchParams(window.location.search).get("slug");
}

/** Saniye → "03:25" veya "1:05:12" */
function formatTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function showError(msg) {
  titleEl.textContent = msg;
  descEl.textContent = "";
  playerShell.style.display = "none";
  navBar.style.display = "none";
  railContainer.style.display = "none";
}

// ---------------------------------------------------------------
// localStorage cache (6 saat TTL)
// ---------------------------------------------------------------

const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 saat (ms)

/** Cache'den seri video listesini oku. Süresi dolmuşsa null döner. */
function getCachedSeries(seriesId) {
  try {
    const raw = localStorage.getItem(`series_${seriesId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.updatedAt > CACHE_TTL) return null;
    return parsed.videos;
  } catch (_) {
    return null;
  }
}

/** Seri video listesini cache'e yaz. */
function setCachedSeries(seriesId, videos) {
  try {
    localStorage.setItem(`series_${seriesId}`, JSON.stringify({
      updatedAt: Date.now(),
      videos,
    }));
  } catch (_) {
    // localStorage dolu veya erişilemez — sessizce devam et
  }
}

// ---------------------------------------------------------------
// Seri video listesini getir (cache → Firestore fallback)
// ---------------------------------------------------------------

async function getSeriesVideos(seriesId) {
  // 1) Cache'e bak
  const cached = getCachedSeries(seriesId);
  if (cached) return cached;

  // 2) Cache yoksa veya süresi dolmuşsa Firestore'dan çek
  const q = query(
    collection(db, "videos"),
    where("isActive", "==", true),
    where("seriesId", "==", seriesId),
    orderBy("order", "asc")
  );
  const snapshot = await getDocs(q);

  const videos = [];
  snapshot.forEach((s) => {
    const d = s.data();
    videos.push({
      slug: s.id,
      title: d.title,
      order: d.order,
      archiveId: d.archiveId,
      description: d.description || "",
    });
  });

  // 3) Cache'e yaz
  setCachedSeries(seriesId, videos);

  return videos;
}

// ---------------------------------------------------------------
// Episode Rail oluştur (3 önceki + mevcut + 3 sonraki)
// ---------------------------------------------------------------

function buildEpisodeRail(allVideos, currentSlug) {
  railTrack.innerHTML = "";

  const currentIdx = allVideos.findIndex((v) => v.slug === currentSlug);
  if (currentIdx === -1) return;

  // 3 önceki + mevcut + 3 sonraki
  const start = Math.max(0, currentIdx - 3);
  const end = Math.min(allVideos.length, currentIdx + 4); // exclusive
  const visible = allVideos.slice(start, end);

  visible.forEach((v) => {
    if (v.slug === currentSlug) {
      // Aktif kart
      const div = document.createElement("div");
      div.className = "ep-card active";

      const watching = document.createElement("span");
      watching.className = "t-overline ep-watching";
      watching.textContent = "Şu An İzleniyor";

      const num = document.createElement("span");
      num.className = "t-overline";
      num.style.color = "var(--text-p)";
      num.textContent = `Bölüm ${String(v.order).padStart(2, "0")}`;

      const title = document.createElement("span");
      title.className = "ep-title";
      title.textContent = v.title;

      div.append(watching, num, title);
      railTrack.appendChild(div);
    } else {
      railTrack.appendChild(createEpCard(v));
    }
  });

  // Aktif kartı ortaya kaydır
  requestAnimationFrame(() => {
    const activeCard = railTrack.querySelector(".ep-card.active");
    if (activeCard && railContainer) {
      const railRect = railContainer.getBoundingClientRect();
      const cardRect = activeCard.getBoundingClientRect();
      const offset =
        cardRect.left - railRect.left + railContainer.scrollLeft -
        railRect.width / 2 + cardRect.width / 2;
      railContainer.scrollLeft = offset;
    }
  });
}

function createEpCard(video) {
  const a = document.createElement("a");
  a.className = "ep-card";
  a.href = `/izle/${encodeURIComponent(video.slug)}`;

  const num = document.createElement("span");
  num.className = "t-overline ep-number";
  num.style.marginBottom = "4px";
  num.textContent = `Bölüm ${String(video.order).padStart(2, "0")}`;

  const title = document.createElement("span");
  title.className = "ep-title";
  title.textContent = video.title;

  a.append(num, title);
  return a;
}

// ---------------------------------------------------------------
// Önceki / Sonraki navigasyon + sayaç
// ---------------------------------------------------------------

function buildNavBar(allVideos, currentSlug) {
  const idx = allVideos.findIndex((v) => v.slug === currentSlug);
  if (idx === -1) return;

  const prev = idx > 0 ? allVideos[idx - 1] : null;
  const next = idx < allVideos.length - 1 ? allVideos[idx + 1] : null;
  const current = allVideos[idx];
  const total = allVideos.length;

  navBar.innerHTML = "";

  // Önceki butonu
  if (prev) {
    const btn = document.createElement("a");
    btn.className = "btn-prev";
    btn.href = `/izle/${encodeURIComponent(prev.slug)}`;
    btn.innerHTML = `<span class="material-symbols-outlined">arrow_back</span> Önceki`;
    navBar.appendChild(btn);
  } else {
    const btn = document.createElement("span");
    btn.className = "btn-prev btn-disabled";
    btn.innerHTML = `<span class="material-symbols-outlined">arrow_back</span> Önceki`;
    navBar.appendChild(btn);
  }

  // Bölüm sayacı
  const info = document.createElement("div");
  info.className = "nav-bar-episode-info t-overline";
  info.textContent = `Bölüm ${current.order} / ${total}`;
  navBar.appendChild(info);

  // Sonraki butonu
  if (next) {
    const btn = document.createElement("a");
    btn.className = "btn-next";
    btn.href = `/izle/${encodeURIComponent(next.slug)}`;
    btn.innerHTML = `Sonraki <span class="material-symbols-outlined">arrow_forward</span>`;
    navBar.appendChild(btn);
  } else {
    const btn = document.createElement("span");
    btn.className = "btn-next btn-disabled";
    btn.innerHTML = `Sonraki <span class="material-symbols-outlined">arrow_forward</span>`;
    navBar.appendChild(btn);
  }
}

// ---------------------------------------------------------------
// Timestamp (Önemli Anlar) listesi
// ---------------------------------------------------------------

function buildTimestamps(timestamps) {
  momentList.innerHTML = "";

  if (!timestamps || timestamps.length === 0) {
    momentsEmpty.style.display = "block";
    momentList.appendChild(momentsEmpty);
    return;
  }

  momentsEmpty.style.display = "none";

  const sorted = [...timestamps].sort((a, b) => a.time - b.time);

  sorted.forEach((ts) => {
    const card = document.createElement("div");
    card.className = "moment-card";

    const timeSpan = document.createElement("span");
    timeSpan.className = "moment-time";
    timeSpan.textContent = formatTime(ts.time);

    const titleSpan = document.createElement("span");
    titleSpan.className = "moment-title";
    titleSpan.textContent = ts.label;

    card.append(timeSpan, titleSpan);

    card.addEventListener("click", () => {
      if (videoPlayer) {
        videoPlayer.currentTime = ts.time;
        videoPlayer.play().catch(() => {});
        videoPlayer.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });

    momentList.appendChild(card);
  });
}

// ---------------------------------------------------------------
// Accordion toggle
// ---------------------------------------------------------------

document.querySelectorAll(".accordion-header").forEach((header) => {
  header.addEventListener("click", () => {
    const blockId = header.dataset.accordion;
    if (blockId) {
      document.getElementById(blockId).classList.toggle("open");
    }
  });
});

// ---------------------------------------------------------------
// Mobile Sticky Video
// ---------------------------------------------------------------

function initStickyVideo() {
  const player = document.querySelector(".player-shell");
  const placeholder = document.querySelector(".player-placeholder");
  const topbar = document.querySelector(".topbar");
  if (!player || !placeholder || !topbar) return;

  let isSticky = false;
  let originalTop = 0;
  const topbarHeight = topbar.offsetHeight;

  function checkSticky() {
    if (window.innerWidth >= 1024) {
      if (isSticky) removeSticky();
      return;
    }
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;
    const triggerPoint = originalTop - topbarHeight;

    if (!isSticky && scrollY > triggerPoint) applySticky();
    else if (isSticky && scrollY <= triggerPoint) removeSticky();
  }

  function applySticky() {
    const rect = player.getBoundingClientRect();
    placeholder.style.width = rect.width + "px";
    placeholder.style.height = rect.height + "px";
    placeholder.classList.add("active");
    player.classList.add("is-sticky");
    isSticky = true;
  }

  function removeSticky() {
    player.classList.remove("is-sticky");
    placeholder.classList.remove("active");
    placeholder.style.width = "";
    placeholder.style.height = "";
    isSticky = false;
  }

  function recalc() {
    if (isSticky) removeSticky();
    originalTop = player.getBoundingClientRect().top + window.pageYOffset;
  }

  recalc();
  window.addEventListener("resize", recalc);
  window.addEventListener("scroll", checkSticky, { passive: true });
}

// ---------------------------------------------------------------
// Ana fonksiyon
// ---------------------------------------------------------------

async function loadVideo() {
  const slug = getSlugFromUrl();
  if (!slug) {
    showError("Video belirtilmedi.");
    return;
  }

  // Video verisini çek (her zaman Firestore'dan — timestamps, description gibi alanlar cache'te yok)
  let snap;
  try {
    snap = await getDoc(doc(db, "videos", slug));
  } catch (err) {
    if (err.code === "permission-denied") {
      showError("Bu video bulunamadı veya kaldırılmış.");
    } else {
      showError("Video yüklenirken bir hata oluştu.");
      console.error(err);
    }
    return;
  }

  if (!snap.exists()) {
    showError("Bu video bulunamadı veya kaldırılmış.");
    return;
  }

  const data = snap.data();

  // Sayfa başlığı
  document.title = `${data.title} — Marginal Archive`;

  // Başlık + açıklama
  titleEl.textContent = data.title;
  descEl.textContent = data.description || "";

  // Video kaynağı
  const videoSrc = `https://archive.org/download/${data.archiveId}/${data.archiveId}.mp4`;
  const source = document.createElement("source");
  source.src = videoSrc;
  source.type = "video/mp4";
  videoPlayer.prepend(source);

  // Sağ tık engelle (caydırıcı)
  videoPlayer.addEventListener("contextmenu", (e) => e.preventDefault());

  // Timestamps
  buildTimestamps(data.timestamps || []);

  // Seri video listesi (cache veya Firestore)
  try {
    const seriesId = data.seriesId;
    if (!seriesId) {
      console.warn("Bu videoda seriesId yok, rail/nav gösterilmiyor.");
      railContainer.style.display = "none";
      navBar.style.display = "none";
    } else {
      const allVideos = await getSeriesVideos(seriesId);
      buildEpisodeRail(allVideos, slug);
      buildNavBar(allVideos, slug);
    }
  } catch (err) {
    console.error("Bölüm verileri yüklenemedi:", err);
    railContainer.style.display = "none";
    navBar.style.display = "none";
  }

  // Slug'ı global sakla (comments.js için)
  window.__currentVideoSlug = slug;

  // Sticky video
  initStickyVideo();
}

export function getCurrentSlug() {
  return getSlugFromUrl();
}

loadVideo();
