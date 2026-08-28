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

const stored = await chrome.storage.local.get(["apiUrl", "syncSecret"]);
apiUrl.value = stored.apiUrl || DEFAULT_API;
syncSecret.value = stored.syncSecret || "";

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
  setStatus("Opening Watch Later and scraping progress…");
  try {
    const result = await chrome.runtime.sendMessage({ type: "SYNC_WATCH_LATER" });
    if (!result?.ok) {
      throw new Error(result?.error || "Sync failed");
    }
    setStatus(
      result.partial
        ? `Synced ${result.upserted} videos (${result.method}), but the scrape looked incomplete. Previous Watch Later entries were kept. Sync again, then refresh the library.`
        : `Synced ${result.upserted} videos (${result.method}). ${result.dropped} marked Dropped. Refresh the library.`,
      "ok",
    );
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    syncButton.disabled = false;
  }
});
