import { db } from "./firebase-config.js";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 saat
export const RESET_COOLDOWN = 10 * 60 * 1000; // 10 dakika

const SERIES_KEY_PREFIX = "series_";

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

export async function getSeriesVideos(seriesId) {
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

/** localStorage'daki tüm seri önbellek kayıtlarının meta bilgisi */
export function getSeriesCacheInfo() {
  let newestUpdatedAt = null;
  let hasCache = false;

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(SERIES_KEY_PREFIX)) continue;
    try {
      const parsed = JSON.parse(localStorage.getItem(key));
      if (parsed?.updatedAt) {
        hasCache = true;
        if (!newestUpdatedAt || parsed.updatedAt > newestUpdatedAt) {
          newestUpdatedAt = parsed.updatedAt;
        }
      }
    } catch (_) {}
  }

  return { hasCache, newestUpdatedAt };
}

/** Son önbellek yazımından bu yana 10 dk geçtiyse sıfırlamaya izin ver */
export function canResetSeriesCache() {
  const { hasCache, newestUpdatedAt } = getSeriesCacheInfo();
  if (!hasCache || !newestUpdatedAt) return false;
  return Date.now() - newestUpdatedAt >= RESET_COOLDOWN;
}

/** Sıfırlamaya kalan süre (ms); hazırsa 0 */
export function msUntilResetAllowed() {
  const { hasCache, newestUpdatedAt } = getSeriesCacheInfo();
  if (!hasCache || !newestUpdatedAt) return Infinity;
  const remaining = RESET_COOLDOWN - (Date.now() - newestUpdatedAt);
  return Math.max(0, remaining);
}

export function clearAllSeriesCache() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(SERIES_KEY_PREFIX)) keys.push(key);
  }
  keys.forEach((key) => localStorage.removeItem(key));
}
