const DEFAULT_API = "https://youtube-watch-later.vercel.app";

const apiUrl = document.getElementById("apiUrl");
const syncSecret = document.getElementById("syncSecret");
const syncButton = document.getElementById("sync");
const status = document.getElementById("status");

function setStatus(text, kind) {
  status.textContent = text;
  status.classList.toggle("is-error", kind === "error");
  status.classList.toggle("is-ok", kind === "ok");
}

const RESET_DROPPED_PENDING_KEY = "resetDroppedPending";

const stored = await chrome.storage.local.get([
  "apiUrl",
  "syncSecret",
  RESET_DROPPED_PENDING_KEY,
]);
apiUrl.value = stored.apiUrl || DEFAULT_API;
syncSecret.value = stored.syncSecret || "";
let resetPending = stored[RESET_DROPPED_PENDING_KEY] !== false;
if (resetPending) {
  setStatus(
    "Next sync restores videos marked Dropped after the first-page-only scrape. A full Watch Later scrape then marks Dropped only for videos missing from YouTube.",
  );
}

async function persist() {
  await chrome.storage.local.set({
    apiUrl: apiUrl.value.trim() || DEFAULT_API,
    syncSecret: syncSecret.value,
  });
}

apiUrl.addEventListener("change", () => void persist());
syncSecret.addEventListener("change", () => void persist());

syncButton.addEventListener("click", async () => {
  await persist();
  syncButton.disabled = true;
  setStatus(
    resetPending
      ? "Opening Watch Later… Restoring Dropped from the incomplete first-page scrape, then merging."
      : "Opening Watch Later and scraping progress…",
  );
  try {
    const result = await chrome.runtime.sendMessage({ type: "SYNC_WATCH_LATER" });
    if (!result?.ok) {
      throw new Error(result?.error || "Sync failed");
    }
    if (result.resetDropped === true) {
      resetPending = false;
    }
    const restored =
      result.resetDropped === true
        ? `Restored ${result.clearedDropped ?? 0} Dropped stamps from the first-page scrape. `
        : "";
    const scrapedCount = result.scraped ?? result.upserted;
    const stated = Number(result.statedCount);
    const ofStated =
      Number.isFinite(stated) && stated > 0 ? ` of ${stated} (stated)` : "";
    const method = result.method ? `, method ${result.method}` : "";
    setStatus(
      result.partial
        ? `${restored}Scraped ${scrapedCount}${ofStated}${method}. The scrape looked incomplete, so previous Watch Later entries were kept. Sync again, then refresh the library.`
        : `${restored}Scraped ${scrapedCount}${ofStated}${method}. ${result.dropped} marked Dropped. Refresh the library.`,
      "ok",
    );
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    syncButton.disabled = false;
  }
});
