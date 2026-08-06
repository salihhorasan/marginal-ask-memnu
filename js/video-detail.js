import { db } from "./firebase-config.js";
import { getSeriesVideos } from "./series-cache.js";
import { ilerlemeOku, ilerlemeYaz, sureBicimle } from "./progress-store.js";
import {
  doc,
  getDoc,
  updateDoc,
  increment,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

// ---------------------------------------------------------------
// DOM referansları
// ---------------------------------------------------------------
const titleEl = document.getElementById("video-title");
const descEl = document.getElementById("video-desc");
const playerShell = document.getElementById("player-shell");
const videoPlayer = document.getElementById("video-player");
const navBar = document.getElementById("nav-bar");
const railTrack = document.getElementById("episode-rail-track");
const railContainer = document.getElementById("episode-rail");
const momentList = document.getElementById("moment-list");
const momentsEmpty = document.getElementById("moments-empty");

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

let videoHatasiGosterildi = false;

/** Video dosyası yüklenemedi — player'ın yerine mesaj koy. */
function showVideoLoadError() {
  if (videoHatasiGosterildi) return;
  videoHatasiGosterildi = true;

  videoPlayer.style.display = "none";

  const kutu = document.createElement("div");
  kutu.className = "player-error";

  const icon = document.createElement("span");
  icon.className = "material-symbols-outlined";
  icon.textContent = "videocam_off";

  const p = document.createElement("p");
  p.textContent = "Video şu anda yüklenemiyor.";

  const sub = document.createElement("p");
  sub.className = "player-error-sub";
  sub.textContent = "Kaynak geçici olarak erişilemez olabilir. Biraz sonra tekrar dene.";

  kutu.append(icon, p, sub);
  playerShell.appendChild(kutu);
}

function showError(msg) {
  titleEl.textContent = msg;
  descEl.textContent = "";
  playerShell.style.display = "none";
  navBar.style.display = "none";
  railContainer.style.display = "none";

  // Sidebar'ı da gizle — video yoksa "Önemli Anlar" ve yorum kutusu
  // göstermenin anlamı yok (comments.js boş bir slug için sorgu atmasın).
  const sidebar = document.querySelector(".sidebar");
  if (sidebar) sidebar.style.display = "none";
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
        videoPlayer.play().catch(() => { });
        videoPlayer.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });

    momentList.appendChild(card);
  });
}

// ---------------------------------------------------------------
// Kaldığın yerden devam et
// ---------------------------------------------------------------
//
// TASARIM KARARI: kendiliğinden ASLA atlamıyoruz. Sayfa baştan açılır,
// kayıt varsa player'ın üstünde küçük bir şerit çıkıp sorar. Böylece
// sayfayı yenilediğinde beklemediğin bir yere fırlamıyorsun.
//
// Tek istisna: ana sayfadaki "Devam Et" kartından gelindiğinde URL'de
// ?devam=1 oluyor — kullanıcı zaten devam etmek istediğini söylemiş,
// o zaman sormadan atlıyoruz.

const KAYIT_ARALIGI = 5000;   // en fazla 5 saniyede bir localStorage'a yaz

let ilerlemeMeta = null;      // { title, archiveId, order }
let sonKayitZamani = 0;

function ilerlemeyiKaydet(slug, zorla = false) {
  if (!ilerlemeMeta || !videoPlayer) return;
  const t = videoPlayer.currentTime;
  const d = videoPlayer.duration;
  if (!Number.isFinite(d) || d <= 0) return;

  const simdi = Date.now();
  if (!zorla && simdi - sonKayitZamani < KAYIT_ARALIGI) return;
  sonKayitZamani = simdi;

  ilerlemeYaz(slug, t, d, ilerlemeMeta);
}

function initProgress(slug, data) {
  ilerlemeMeta = {
    title: data.title,
    archiveId: data.archiveId,
    order: data.order,
  };

  videoPlayer.addEventListener("timeupdate", () => ilerlemeyiKaydet(slug));
  videoPlayer.addEventListener("pause", () => ilerlemeyiKaydet(slug, true));
  // pagehide, sekme kapatma/geri gitme dahil daha güvenilir çalışıyor
  window.addEventListener("pagehide", () => ilerlemeyiKaydet(slug, true));

  const kayit = ilerlemeOku(slug);
  if (!kayit || kayit.bitti || kayit.t < 30) return;

  const devamIstendi = new URLSearchParams(window.location.search).get("devam") === "1";

  if (devamIstendi) {
    devamEt(kayit.t);
  } else {
    devamSeridiGoster(slug, kayit.t);
  }
}

function devamEt(saniye) {
  const uygula = () => { videoPlayer.currentTime = saniye; };
  // Metadata gelmeden currentTime atanamaz
  if (videoPlayer.readyState >= 1) uygula();
  else videoPlayer.addEventListener("loadedmetadata", uygula, { once: true });
}

/**
 * Player'ın tamamını kaplayan seçim katmanı.
 *
 * Player'ın İÇİNE (absolute) yerleştiriliyor — normal akışa girseydi
 * altındaki her şeyi aşağı iter, yeni düzelttiğimiz CLS sorununu
 * geri getirirdi.
 *
 * Tüm alanı kapladığı için kullanıcı videoya dokunup oynatamıyor;
 * iki seçenekten birini seçmek zorunda. Klavye kısayolları da bu
 * sırada devre dışı (initShortcuts içinde kontrol ediliyor).
 */
let secimKatmani = null;

function devamSeridiGoster(slug, saniye) {
  const katman = document.createElement("div");
  katman.className = "resume-overlay";

  const grup = document.createElement("div");
  grup.className = "resume-buttons";

  const devamBtn = document.createElement("button");
  devamBtn.type = "button";
  devamBtn.className = "resume-btn resume-continue";
  devamBtn.innerHTML =
    '<span class="material-symbols-outlined">play_arrow</span>' +
    `<span>${sureBicimle(saniye)}'ten devam et</span>`;
  devamBtn.addEventListener("click", () => {
    devamEt(saniye);
    katmaniKapat(katman);
    videoPlayer.play().catch(() => {});
  });

  const bastanBtn = document.createElement("button");
  bastanBtn.type = "button";
  bastanBtn.className = "resume-btn resume-restart";
  bastanBtn.innerHTML =
    '<span class="material-symbols-outlined">restart_alt</span>' +
    "<span>Baştan başla</span>";
  bastanBtn.addEventListener("click", () => {
    devamEt(0);
    katmaniKapat(katman);
    videoPlayer.play().catch(() => {});
  });

  grup.append(devamBtn, bastanBtn);
  katman.appendChild(grup);
  playerShell.appendChild(katman);

  secimKatmani = katman;
  devamBtn.focus();
}

function katmaniKapat(katman) {
  katman.remove();
  if (secimKatmani === katman) secimKatmani = null;
}

// ---------------------------------------------------------------
// Klavye kısayolları
// ---------------------------------------------------------------
//
// Odak bir yazı alanındayken veya yorum modalı açıkken tamamen devre dışı —
// yorum yazarken "f" harfine basınca tam ekrana geçmesi kabul edilemez.

function yaziYaziliyorMu() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function initShortcuts() {
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (yaziYaziliyorMu()) return;
    if (document.body.classList.contains("comment-modal-open")) return;
    // Devam/baştan seçimi bekliyorsa video kilitli — klavye de kilitli olmalı
    if (secimKatmani) return;
    if (!videoPlayer || videoPlayer.style.display === "none") return;

    switch (e.key) {
      case " ":
      case "k":
      case "K":
        e.preventDefault();
        videoPlayer.paused ? videoPlayer.play().catch(() => {}) : videoPlayer.pause();
        break;

      case "ArrowLeft":
        e.preventDefault();
        videoPlayer.currentTime = Math.max(0, videoPlayer.currentTime - 10);
        break;

      case "ArrowRight":
        e.preventDefault();
        videoPlayer.currentTime = Math.min(
          videoPlayer.duration || Infinity,
          videoPlayer.currentTime + 10
        );
        break;

      case "ArrowUp":
        e.preventDefault();
        videoPlayer.muted = false;
        videoPlayer.volume = Math.min(1, videoPlayer.volume + 0.1);
        break;

      case "ArrowDown":
        e.preventDefault();
        videoPlayer.volume = Math.max(0, videoPlayer.volume - 0.1);
        break;

      case "m":
      case "M":
        e.preventDefault();
        videoPlayer.muted = !videoPlayer.muted;
        break;

      case "f":
      case "F":
        e.preventDefault();
        if (document.fullscreenElement) {
          document.exitFullscreen?.();
        } else {
          (videoPlayer.requestFullscreen?.() ??
            videoPlayer.webkitEnterFullscreen?.())?.catch?.(() => {});
        }
        break;
    }
  });
}

// ---------------------------------------------------------------
// Bağlantı hızına göre preload kararı
// ---------------------------------------------------------------

/**
 * Veri tasarrufu gerektiren bir bağlantı mı?
 *
 * `preload="auto"` bilinçli bir tercih: kullanıcı oynat'a bastığında video
 * beklemeden başlasın diye. Bedeli, sayfayı açıp hemen kapatan birinin bile
 * onlarca MB indirmesi. Bu fonksiyon sadece gerçekten sıkışık bağlantılarda
 * `metadata`'ya düşmemizi sağlıyor.
 *
 * navigator.connection Safari ve Firefox'ta yok (MDN: "limited availability").
 * Sorun değil: `preload="auto"`yu zaten yok sayan tarayıcı iOS Safari ve
 * API'si olmayan da o. Mobil veride auto'yu gerçekten uygulayan Android
 * Chrome ise API'yi sunuyor. API yoksa hiçbir şey yapmıyoruz.
 *
 * Okunan değer hiçbir yere gönderilmiyor, sadece burada karar için kullanılıyor.
 */
function tasarrufluBaglantiMi() {
  const c = navigator.connection;
  if (!c) return false;              // API yok → karışma, auto kalsın
  if (c.saveData) return true;       // kullanıcı açıkça veri tasarrufu istemiş

  // effectiveType radyo tipi değil, tarayıcının gözlemlediği gecikme/hızdan
  // hesapladığı deneyim sınıfı. "3g" bilerek dahil edilmedi — makul hızdaki
  // bağlantılar da o sınıfa düşebiliyor ve anında başlama davranışı bozulurdu.
  const t = c.effectiveType;
  return t === "slow-2g" || t === "2g";
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
  // NOT: Archive.org'daki dosya adının identifier ile aynı ve .mp4 olduğu
  // varsayılıyor. Bu varsayım tutmazsa aşağıdaki error dinleyicisi devreye girer.
  const videoSrc = `https://archive.org/download/${data.archiveId}/${data.archiveId}.mp4`;
  const source = document.createElement("source");
  source.src = videoSrc;
  source.type = "video/mp4";

  // Kaynak yüklenemezse kullanıcıya söyle — eskiden sessizce boş player kalıyordu
  source.addEventListener("error", showVideoLoadError);
  videoPlayer.addEventListener("error", showVideoLoadError);

  // Sıkışık bağlantıda tüm videoyu indirme. Kaynak henüz eklenmediği için
  // tarayıcı hiçbir şey indirmeye başlamadı — burada değiştirmek güvenli.
  if (tasarrufluBaglantiMi()) {
    videoPlayer.preload = "metadata";
  }

  videoPlayer.prepend(source);

  // Sağ tık engelle (caydırıcı)
  videoPlayer.addEventListener("contextmenu", (e) => e.preventDefault());

  // Timestamps
  buildTimestamps(data.timestamps || []);

  // Seri video listesi (cache veya Firestore)
  await buildSeriesUI(data.seriesId, slug);

  // Önbellek sıfırlanınca rail ve önceki/sonraki'yi tazele.
  // (Eskiden bu dinleyici yoktu; footer'daki "Sıfırla" video sayfasında
  //  görünürde hiçbir şey yapmıyordu, sayfa yenilenene kadar eski veri kalıyordu.)
  window.addEventListener("series-cache-cleared", () => {
    buildSeriesUI(data.seriesId, slug);
  });

  // Sticky video
  initStickyVideo();

  // İzlenme sayacı
  initViewTracking(slug);

  // Kaldığın yerden devam et + klavye kısayolları
  initProgress(slug, data);
  initShortcuts();
}

/** Episode rail + önceki/sonraki navigasyonunu kur. */
async function buildSeriesUI(seriesId, slug) {
  if (!seriesId) {
    console.warn("Bu videoda seriesId yok, rail/nav gösterilmiyor.");
    railContainer.style.display = "none";
    navBar.style.display = "none";
    return;
  }

  try {
    const allVideos = await getSeriesVideos(seriesId);
    railContainer.style.display = "";
    navBar.style.display = "";
    buildEpisodeRail(allVideos, slug);
    buildNavBar(allVideos, slug);
  } catch (err) {
    console.error("Bölüm verileri yüklenemedi:", err);
    railContainer.style.display = "none";
    navBar.style.display = "none";
  }
}

// ---------------------------------------------------------------
// İzlenme sayacı (5 dk play time + 24 saat cooldown)
// ---------------------------------------------------------------

const VIEW_COOLDOWN = 24 * 60 * 60 * 1000; // 24 saat
const VIEW_THRESHOLD = 5 * 60; // 5 dakika (saniye)

function initViewTracking(slug) {
  // 24 saat içinde zaten sayıldıysa takip etme
  const viewKey = `view_${slug}`;
  try {
    const lastView = localStorage.getItem(viewKey);
    if (lastView && Date.now() - parseInt(lastView) < VIEW_COOLDOWN) return;
  } catch (_) { }

  let totalPlayTime = 0;
  let lastTime = 0;

  function onTimeUpdate() {
    const current = videoPlayer.currentTime;
    // Normal oynatma: zaman farkı 0-2 saniye arası (seek değil)
    if (current > lastTime && current - lastTime < 2) {
      totalPlayTime += current - lastTime;
    }
    lastTime = current;

    if (totalPlayTime >= VIEW_THRESHOLD) {
      // İş bitti — dinleyiciyi kaldır, boşuna tetiklenmesin
      videoPlayer.removeEventListener("timeupdate", onTimeUpdate);
      countView(slug);
    }
  }

  videoPlayer.addEventListener("timeupdate", onTimeUpdate);
}

async function countView(slug) {
  try {
    await updateDoc(doc(db, "videos", slug), {
      viewCount: increment(1),
    });
    // Cooldown kaydet
    try {
      localStorage.setItem(`view_${slug}`, String(Date.now()));
    } catch (_) { }
  } catch (err) {
    console.error("İzlenme sayılamadı:", err);
  }
}

export function getCurrentSlug() {
  return getSlugFromUrl();
}

loadVideo();