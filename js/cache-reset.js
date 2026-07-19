import {
  canResetSeriesCache,
  clearAllSeriesCache,
  getSeriesCacheInfo,
  msUntilResetAllowed,
} from "./series-cache.js";

const resetBtn = document.getElementById("cache-reset-btn");

if (resetBtn) {
  function formatRemaining(ms) {
    const minutes = Math.ceil(ms / 60_000);
    if (minutes <= 1) return "1 dk";
    return `${minutes} dk`;
  }

  function updateResetButton() {
    const { hasCache } = getSeriesCacheInfo();

    if (!hasCache) {
      resetBtn.disabled = true;
      resetBtn.textContent = "Sıfırla";
      resetBtn.title = "Önbellekte veri yok.";
      return;
    }

    if (canResetSeriesCache()) {
      resetBtn.disabled = false;
      resetBtn.textContent = "Sıfırla";
      resetBtn.title = "Önbelleği temizle ve güncel veriyi çek.";
      return;
    }

    const remaining = msUntilResetAllowed();
    resetBtn.disabled = true;
    resetBtn.textContent = `Sıfırla (${formatRemaining(remaining)})`;
    resetBtn.title = "Önbellek en az 10 dakika önce oluşturulmalı.";
  }

  resetBtn.addEventListener("click", () => {
    if (!canResetSeriesCache()) return;

    clearAllSeriesCache();
    localStorage.removeItem("banner_config_cache");
    window.dispatchEvent(new CustomEvent("series-cache-cleared"));
    updateResetButton();
  });

  updateResetButton();
  setInterval(updateResetButton, 30_000);
}
