const WL_URL = "https://www.youtube.com/playlist?list=WL";
const DEFAULT_API = "https://youtube-watch-later.vercel.app";

async function getSettings() {
  const stored = await chrome.storage.local.get(["apiUrl", "syncSecret"]);
  return {
    apiUrl: (stored.apiUrl || DEFAULT_API).replace(/\/$/, ""),
    syncSecret: stored.syncSecret || "",
  };
}

function isWatchLaterTab(tab) {
  if (!tab?.url) return false;
  try {
    const url = new URL(tab.url);
    return (
      (url.hostname === "www.youtube.com" || url.hostname === "youtube.com") &&
      url.pathname === "/playlist" &&
      url.searchParams.get("list") === "WL"
    );
  } catch {
    return false;
  }
}

function waitForComplete(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timed out waiting for Watch Later to load"));
    }, 45000);

    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function findOrOpenWatchLater() {
  const tabs = await chrome.tabs.query({
    url: ["https://www.youtube.com/playlist*", "https://youtube.com/playlist*"],
  });
  const existing = tabs.find(isWatchLaterTab);
  if (existing?.id != null) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.status !== "complete") {
      await waitForComplete(existing.id);
    }
    return existing.id;
  }

  const created = await chrome.tabs.create({ url: WL_URL, active: true });
  if (created.id == null) throw new Error("Could not open Watch Later");
  await waitForComplete(created.id);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return created.id;
}

async function previousOnListCount(apiUrl) {
  try {
    const response = await fetch(`${apiUrl}/api/library`, { cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json();
    const videos = Array.isArray(payload?.videos) ? payload.videos : [];
    const onList = videos.filter((video) => video?.id && video.droppedAt == null).length;
    return onList > 0 ? onList : null;
  } catch {
    return null;
  }
}

async function scrapeTab(tabId, expectedCount) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: ["scrape.js"],
  });
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (expected) => {
      if (typeof window.__watchLaterScrape !== "function") {
        throw new Error("Scrape helper did not load");
      }
      return window.__watchLaterScrape({ expectedCount: expected });
    },
    args: [expectedCount ?? null],
  });
  if (injection?.error) throw new Error(injection.error.message);
  return injection?.result;
}

const RESET_DROPPED_PENDING_KEY = "resetDroppedPending";

async function shouldResetDropped() {
  const stored = await chrome.storage.local.get([RESET_DROPPED_PENDING_KEY]);
  return stored[RESET_DROPPED_PENDING_KEY] !== false;
}

async function markResetDroppedDone() {
  await chrome.storage.local.set({ [RESET_DROPPED_PENDING_KEY]: false });
}

async function postSync(apiUrl, syncSecret, videos, resetDropped) {
  const response = await fetch(`${apiUrl}/api/sync`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sync-secret": syncSecret,
    },
    body: JSON.stringify({ videos, ...(resetDropped ? { resetDropped: true } : {}) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Sync failed (${response.status})`);
  }
  return payload;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SYNC_WATCH_LATER") return undefined;

  (async () => {
    const { apiUrl, syncSecret } = await getSettings();
    if (!syncSecret) {
      throw new Error("Set the sync secret in this popup (same value as Vercel SYNC_SECRET).");
    }
    const [tabId, expectedCount] = await Promise.all([
      findOrOpenWatchLater(),
      previousOnListCount(apiUrl),
    ]);
    const scraped = await scrapeTab(tabId, expectedCount);
    if (!scraped?.videos?.length) {
      throw new Error("No Watch Later videos were scraped.");
    }
    const resetDropped = await shouldResetDropped();
    const result = await postSync(apiUrl, syncSecret, scraped.videos, resetDropped);
    if (resetDropped && result.resetDropped === true) {
      await markResetDroppedDone();
    }
    return {
      ok: true,
      method: scraped.method,
      scraped: scraped.videos.length,
      resetDropped: result.resetDropped === true,
      clearedDropped: result.clearedDropped ?? 0,
      ...result,
    };
  })()
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });

  return true;
});
