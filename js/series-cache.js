import { db } from "./firebase-config.js";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

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
