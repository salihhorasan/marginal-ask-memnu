import { db } from "./firebase-config.js";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// ---------------------------------------------------------------
// localStorage cache (video-detail.js ile paylaşımlı format)
// ---------------------------------------------------------------

const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 saat

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

function setCachedSeries(seriesId, videos) {
  try {
    localStorage.setItem(`series_${seriesId}`, JSON.stringify({
      updatedAt: Date.now(),
      videos,
    }));
  } catch (_) {}
}

// ---------------------------------------------------------------
// Seri video listesini getir (cache → Firestore fallback)
// ---------------------------------------------------------------

async function getSeriesVideos(seriesId) {
  const cached = getCachedSeries(seriesId);
  if (cached) return cached;

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

  setCachedSeries(seriesId, videos);
  return videos;
}

// ---------------------------------------------------------------
// DOM referansları
// ---------------------------------------------------------------

const gridEl = document.getElementById("series-grid");

// Hangi serilerin videoları zaten yüklendiğini takip et
const loadedSeries = new Set();

// ---------------------------------------------------------------
// Seri kartı oluştur
// ---------------------------------------------------------------

function createSeriesCard(series, index) {
  const checkboxId = `series-${index}`;

  const wrapper = document.createElement("div");
  wrapper.className = "card-wrapper";

  // Gizli checkbox
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = checkboxId;
  checkbox.className = "series-trigger";

  // Checkbox değişince videoları lazy load et
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      loadVideosForSeries(series.id, wrapper);
    }
  });

  // Kart
  const card = document.createElement("div");
  card.className = "card";

  // Açma trigger'ı (label)
  const openTrigger = document.createElement("label");
  openTrigger.className = "open-trigger";
  openTrigger.htmlFor = checkboxId;

  // Geri butonu (label)
  const backBtn = document.createElement("label");
  backBtn.className = "back-btn";
  backBtn.htmlFor = checkboxId;
  backBtn.innerHTML = "&larr; Tüm Seriler";

  // Kapak görseli
  const cover = document.createElement("div");
  cover.className = "card-cover";

  if (series.archiveId) {
    const img = document.createElement("img");
    img.src = `https://archive.org/services/img/${series.archiveId}`;
    img.alt = series.title;
    img.loading = "lazy";
    cover.appendChild(img);
  } else {
    const placeholder = document.createElement("span");
    placeholder.className = "cover-placeholder";
    placeholder.textContent = series.title;
    cover.appendChild(placeholder);
  }

  // Kart body
  const body = document.createElement("div");
  body.className = "card-body";

  const title = document.createElement("h2");
  title.className = "series-title";
  title.textContent = series.title;

  const desc = document.createElement("p");
  desc.className = "series-desc";
  desc.textContent = series.description || "";

  // Video içerik alanı (lazy load edilecek)
  const innerContent = document.createElement("div");
  innerContent.className = "inner-video-content";

  const videoGrid = document.createElement("div");
  videoGrid.className = "video-grid";
  videoGrid.innerHTML = '<p class="loading-state">Videolar yükleniyor…</p>';

  innerContent.appendChild(videoGrid);
  body.append(title, desc, innerContent);
  card.append(openTrigger, backBtn, cover, body);
  wrapper.append(checkbox, card);

  return wrapper;
}

// ---------------------------------------------------------------
// Seri açılınca videoları yükle
// ---------------------------------------------------------------

async function loadVideosForSeries(seriesId, wrapperEl) {
  if (loadedSeries.has(seriesId)) return;

  const videoGrid = wrapperEl.querySelector(".video-grid");

  try {
    const videos = await getSeriesVideos(seriesId);

    videoGrid.innerHTML = "";

    if (videos.length === 0) {
      videoGrid.innerHTML = '<p class="loading-state">Bu seride henüz video yok.</p>';
      loadedSeries.add(seriesId);
      return;
    }

    videos.forEach((v) => {
      const item = document.createElement("a");
      item.className = "video-item";
      item.href = `video.html?slug=${encodeURIComponent(v.slug)}`;

      // Thumbnail
      const thumb = document.createElement("div");
      thumb.className = "video-thumb";
      const img = document.createElement("img");
      img.src = `https://archive.org/services/img/${v.archiveId}`;
      img.alt = v.title;
      img.loading = "lazy";
      thumb.appendChild(img);

      // Body
      const body = document.createElement("div");
      body.className = "video-card-body";

      const badge = document.createElement("span");
      badge.className = "video-badge";
      badge.textContent = `Bölüm ${String(v.order).padStart(2, "0")}`;

      const title = document.createElement("h3");
      title.className = "video-title";
      title.textContent = v.title;

      const desc = document.createElement("p");
      desc.className = "video-desc";
      desc.textContent = v.description;

      body.append(badge, title, desc);
      item.append(thumb, body);
      videoGrid.appendChild(item);
    });

    loadedSeries.add(seriesId);
  } catch (err) {
    console.error("Videolar yüklenemedi:", err);
    videoGrid.innerHTML = '<p class="loading-state">Videolar yüklenirken bir hata oluştu.</p>';
  }
}

// ---------------------------------------------------------------
// Serileri yükle ve render et
// ---------------------------------------------------------------

async function loadSeries() {
  const q = query(
    collection(db, "series"),
    where("isActive", "==", true),
    orderBy("order", "asc")
  );

  let snapshot;
  try {
    snapshot = await getDocs(q);
  } catch (err) {
    console.error("Seriler yüklenemedi:", err);
    gridEl.innerHTML = '<p class="loading-state">Seriler yüklenirken bir hata oluştu.</p>';
    return;
  }

  if (snapshot.empty) {
    gridEl.innerHTML = '<p class="loading-state">Henüz içerik eklenmedi.</p>';
    return;
  }

  gridEl.innerHTML = "";

  const seriesList = [];
  snapshot.forEach((s) => {
    seriesList.push({ id: s.id, ...s.data() });
  });

  seriesList.forEach((series, i) => {
    const card = createSeriesCard(series, i);
    gridEl.appendChild(card);
  });
}

loadSeries();