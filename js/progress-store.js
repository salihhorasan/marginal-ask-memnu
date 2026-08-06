// ---------------------------------------------------------------
// İzleme ilerlemesi deposu (localStorage)
// ---------------------------------------------------------------
//
// Hem video sayfası (kaldığın yerden devam et) hem ana sayfa (Devam Et
// bölümü) buradan okuyup yazar. series-cache.js ile aynı desen.
//
// Firestore'a hiç gidilmiyor: kart için gereken başlık ve kapak görseli
// kaydın içinde tutuluyor, böylece ana sayfa sıfır okuma maliyetiyle
// "nerede kalmıştım" listesini çizebiliyor.
//
// Kayıt biçimi — progress_{slug}:
//   { t, d, updatedAt, title, archiveId, order, bitti }
//   t         : saniye cinsinden son konum
//   d         : videonun toplam süresi (ilerleme yüzdesi için)
//   updatedAt : son dokunulma zamanı (sıralama ve budama için)
//   bitti     : %99'u geçildiyse true — kayıt silinmez, "İzlendi" işaretlenir

const ANAHTAR_ONEKI = "progress_";

/** Ekranda gösterilecek kart sayısı. */
export const GOSTERILECEK = 3;

/**
 * Saklanacak azami kayıt sayısı.
 *
 * Süreli silme yerine sayı sınırı tercih edildi: bir kayıt "zaman aşımına
 * uğradı" diye kaybolmuyor, sadece çok daha yeni 20 kayıt birikince
 * en eskisi düşüyor. Ekranda 3 görünüyor, kalanlar uzun bir seriye
 * döndüğünde yerin hatırlansın diye arka planda duruyor.
 */
const AZAMI_KAYIT = 20;

/** Bu saniyenin altındaki ilerleme kaydedilmez — devam etmenin anlamı yok. */
const ASGARI_SANIYE = 60;

/** Bu oranı geçen video bitmiş sayılır. */
const BITTI_ORANI = 0.99;

function anahtar(slug) {
  return ANAHTAR_ONEKI + slug;
}

/** Tek bir kaydı oku. Yoksa veya bozuksa null. */
export function ilerlemeOku(slug) {
  try {
    const raw = localStorage.getItem(anahtar(slug));
    if (!raw) return null;
    const k = JSON.parse(raw);
    if (typeof k?.t !== "number" || typeof k?.d !== "number") return null;
    return k;
  } catch (_) {
    return null;
  }
}

/**
 * İlerlemeyi kaydet.
 *
 * @param {string} slug
 * @param {number} t     saniye cinsinden konum
 * @param {number} d     videonun süresi
 * @param {object} meta  { title, archiveId, order } — kart için
 */
export function ilerlemeYaz(slug, t, d, meta = {}) {
  if (!slug || !Number.isFinite(t) || !Number.isFinite(d) || d <= 0) return;

  const bitti = t >= d * BITTI_ORANI;

  // Videonun başındayken kayıt açma. Ama zaten kayıt varsa (kullanıcı
  // başa sardıysa) güncellemeye devam et, yoksa eski konum donup kalır.
  if (t < ASGARI_SANIYE && !bitti && !ilerlemeOku(slug)) return;

  try {
    localStorage.setItem(anahtar(slug), JSON.stringify({
      t: Math.floor(t),
      d: Math.floor(d),
      updatedAt: Date.now(),
      title: meta.title || "",
      archiveId: meta.archiveId || "",
      order: meta.order ?? null,
      bitti,
    }));
    buda();
  } catch (_) {
    // Kota dolu veya erişilemez — sessizce vazgeç
  }
}

/** Tek bir kaydı sil. */
export function ilerlemeSil(slug) {
  try {
    localStorage.removeItem(anahtar(slug));
  } catch (_) {}
}

/** Tüm kayıtları en yeniden eskiye sıralı döndür. */
export function tumIlerlemeler() {
  const liste = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(ANAHTAR_ONEKI)) continue;
      try {
        const kayit = JSON.parse(localStorage.getItem(k));
        if (typeof kayit?.updatedAt !== "number") continue;
        liste.push({ slug: k.slice(ANAHTAR_ONEKI.length), ...kayit });
      } catch (_) {}
    }
  } catch (_) {
    return [];
  }
  return liste.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Ana sayfada gösterilecek son kayıtlar. */
export function sonIzlenenler(adet = GOSTERILECEK) {
  return tumIlerlemeler().slice(0, adet);
}

/** AZAMI_KAYIT üstündeki en eski kayıtları sil. */
function buda() {
  const hepsi = tumIlerlemeler();
  if (hepsi.length <= AZAMI_KAYIT) return;
  hepsi.slice(AZAMI_KAYIT).forEach((k) => ilerlemeSil(k.slug));
}

/** 0-100 arası ilerleme yüzdesi. */
export function yuzde(kayit) {
  if (!kayit?.d) return 0;
  if (kayit.bitti) return 100;
  return Math.min(100, Math.max(0, Math.round((kayit.t / kayit.d) * 100)));
}

/** Saniye → "12:34" veya "1:05:12" */
export function sureBicimle(saniye) {
  const s = Math.max(0, Math.floor(saniye));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sn = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sn).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sn).padStart(2, "0")}`;
}
