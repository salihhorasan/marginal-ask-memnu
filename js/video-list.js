import { db } from "./firebase-config.js";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const container = document.getElementById("video-list");

async function loadVideos() {
  const q = query(
    collection(db, "videos"),
    where("isActive", "==", true),
    orderBy("createdAt", "desc")
  );

  let snapshot;
  try {
    snapshot = await getDocs(q);
  } catch (err) {
    container.textContent = "Videolar yüklenirken bir hata oluştu.";
    console.error(err);
    return;
  }

  if (snapshot.empty) {
    container.textContent = "Henüz video eklenmedi.";
    return;
  }

  container.innerHTML = "";

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const slug = docSnap.id;

    const card = document.createElement("a");
    card.href = `video.html?slug=${encodeURIComponent(slug)}`;
    card.className = "video-card";

    const thumb = document.createElement("img");
    thumb.src = `https://archive.org/services/img/${data.archiveId}`;
    thumb.alt = data.title;
    thumb.loading = "lazy";

    const title = document.createElement("h3");
    title.textContent = data.title;

    card.append(thumb, title);
    container.appendChild(card);
  });
}

loadVideos();
