// ---------------------------------------------------------------
// Ana sayfa — "Devam Et" bölümü
// ---------------------------------------------------------------
//
// Tamamen localStorage'dan besleniyor, Firestore'a hiç gitmiyor.
// Kayıt yoksa bölüm hiç render edilmiyor.

import {
  sonIzlenenler,
  ilerlemeSil,
  yuzde,
  sureBicimle,
} from "./progress-store.js";

const bolum = document.getElementById("continue-section");
const grid = document.getElementById("continue-grid");

function kartOlustur(kayit) {
  const oran = yuzde(kayit);

  const item = document.createElement("a");
  item.className = "video-item continue-item";
  item.href = `/izle/${encodeURIComponent(kayit.slug)}?devam=1`;

  // ── Kapak (mobilde gizli) ──
  const thumb = document.createElement("div");
  thumb.className = "video-thumb";
  if (kayit.archiveId) {
    const img = document.createElement("img");
    img.src = `https://archive.org/services/img/${kayit.archiveId}`;
    img.alt = kayit.title || kayit.slug;
    img.loading = "lazy";
    thumb.appendChild(img);
  }

  // ── Gövde: ilerleme buranın arka planına çiziliyor ──
  const body = document.createElement("div");
  body.className = "video-card-body continue-body";
  body.style.setProperty("--ilerleme", `${oran}%`);

  // Çarpı + bölüm rozeti tek satırda. Kapağın içinde değil gövdede duruyor:
  // mobilde .video-thumb gizlendiği için orada görünmüyordu.
  const head = document.createElement("div");
  head.className = "continue-head";

  const kaldir = document.createElement("button");
  kaldir.type = "button";
  kaldir.className = "continue-remove";
  kaldir.setAttribute("aria-label", "Listeden çıkar");
  kaldir.title = "Listeden çıkar";
  kaldir.innerHTML = '<span class="material-symbols-outlined">close</span>';
  kaldir.addEventListener("click", (e) => {
    // Kart bir <a> — tıklamanın videoya gitmesini engelle
    e.preventDefault();
    e.stopPropagation();
    ilerlemeSil(kayit.slug);
    render();
  });

  const badge = document.createElement("span");
  badge.className = "video-badge";
  badge.textContent = kayit.order != null
    ? `Bölüm ${String(kayit.order).padStart(2, "0")}`
    : "Bölüm";

  head.append(kaldir, badge);

  const title = document.createElement("h3");
  title.className = "video-title";
  title.textContent = kayit.title || kayit.slug;

  const durum = document.createElement("span");
  durum.className = "continue-status";
  durum.textContent = kayit.bitti
    ? "İzlendi"
    : `${sureBicimle(kayit.t)} / ${sureBicimle(kayit.d)}`;
  if (kayit.bitti) durum.classList.add("bitti");

  body.append(head, title, durum);
  item.append(thumb, body);
  return item;
}

function render() {
  if (!bolum || !grid) return;

  const kayitlar = sonIzlenenler();

  if (kayitlar.length === 0) {
    bolum.style.display = "none";
    grid.innerHTML = "";
    return;
  }

  bolum.style.display = "";
  grid.innerHTML = "";
  kayitlar.forEach((k) => grid.appendChild(kartOlustur(k)));
}

render();
