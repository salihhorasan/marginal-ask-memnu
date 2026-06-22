import { db } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const container = document.getElementById("video-detail");

function getSlugFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("slug");
}

async function loadVideo() {
  const slug = getSlugFromUrl();
  if (!slug) {
    container.textContent = "Video belirtilmedi.";
    return;
  }

  let snap;
  try {
    snap = await getDoc(doc(db, "videos", slug));
  } catch (err) {
    // isActive=false ya da slug hiç yoksa security rules zaten erişimi
    // reddediyor - ikisi de client'a "permission-denied" olarak görünür.
    if (err.code === "permission-denied") {
      container.textContent = "Bu video bulunamadı veya kaldırılmış.";
    } else {
      container.textContent = "Video yüklenirken bir hata oluştu.";
      console.error(err);
    }
    return;
  }

  if (!snap.exists()) {
    container.textContent = "Bu video bulunamadı veya kaldırılmış.";
    return;
  }

  const data = snap.data();

  container.innerHTML = "";

  const title = document.createElement("h1");
  title.textContent = data.title;

  const iframe = document.createElement("iframe");
  iframe.src = `https://archive.org/embed/${data.archiveId}`;
  iframe.width = "640";
  iframe.height = "480";
  iframe.style.border = "0";
  iframe.allowFullscreen = true;

  const description = document.createElement("p");
  description.textContent = data.description || "";

  container.append(title, iframe, description);
}

loadVideo();
