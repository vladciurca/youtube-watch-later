import {
  finishJob,
  initialJob,
  recordResult,
  selectDoneToSync,
} from "./done-sync.js";

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

async function postSync(apiUrl, syncSecret, videos, resetDropped, statedCountValue) {
  const statedCount = Number(statedCountValue);
  const response = await fetch(`${apiUrl}/api/sync`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sync-secret": syncSecret,
    },
    body: JSON.stringify({
      videos,
      ...(Number.isFinite(statedCount) && statedCount > 0 ? { statedCount } : {}),
      ...(resetDropped ? { resetDropped: true } : {}),
    }),
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
    const result = await postSync(
      apiUrl,
      syncSecret,
      scraped.videos,
      resetDropped,
      scraped.statedCount,
    );
    if (resetDropped && result.resetDropped === true) {
      await markResetDroppedDone();
    }
    return {
      ok: true,
      ...result,
      method: scraped.method,
      scraped: scraped.videos.length,
      statedCount: scraped.statedCount ?? result.statedCount ?? null,
      resetDropped: result.resetDropped === true,
      clearedDropped: result.clearedDropped ?? 0,
    };
  })()
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });

  return true;
});

// ---------------------------------------------------------------------------
// Sync Done to YouTube (manual only). Nothing here runs unless the popup sends
// DONE_SYNC_PREVIEW and then DONE_SYNC_START after the user confirms.
// ---------------------------------------------------------------------------

const JOB_KEY = "doneSyncJob";
const SYNCED_KEY = "doneSynced";
const SKIPPED_KEY = "doneSyncSkipped";
const PER_VIDEO_TIMEOUT_MS = 100000;
const DEFAULT_WATCH_BASE = "https://www.youtube.com/watch";

let jobActive = false;
let cancelRequested = false;
let currentWindowId = null;

// A service worker restart kills a running job; never leave it looking alive.
(async () => {
  const stored = await chrome.storage.local.get([JOB_KEY]);
  const job = stored[JOB_KEY];
  if (job?.state === "running") {
    await chrome.storage.local.set({
      [JOB_KEY]: { ...job, state: "interrupted", current: null, finishedAt: Date.now() },
    });
  }
})();

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url.replace(/^https?:\/\/[^/]+/, "")} returned ${response.status}`);
  return response.json();
}

async function previewDoneSync() {
  const { apiUrl } = await getSettings();
  const [done, library, stored] = await Promise.all([
    fetchJson(`${apiUrl}/api/done`),
    fetchJson(`${apiUrl}/api/library`),
    chrome.storage.local.get([SYNCED_KEY, SKIPPED_KEY]),
  ]);
  const selection = selectDoneToSync({
    doneItems: done.items ?? [],
    videos: library.videos ?? [],
    synced: stored[SYNCED_KEY] ?? {},
    skipped: stored[SKIPPED_KEY] ?? {},
  });
  return {
    ok: true,
    count: selection.toSync.length,
    counts: selection.counts,
    totalDone: (done.items ?? []).length,
    titles: selection.toSync.slice(0, 5).map((video) => video.title),
  };
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const done = (fn, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      fn(value);
    };
    const timer = setTimeout(() => done(reject, new Error("page load timed out")), timeoutMs);
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") done(resolve);
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(
      (tab) => {
        if (tab.status === "complete") done(resolve);
      },
      (error) => done(reject, error),
    );
  });
}

async function closeWindow(windowId) {
  if (windowId == null) return;
  try {
    await chrome.windows.remove(windowId);
  } catch {
    // already closed
  }
}

// One video. Chrome does not load or play media in hidden (background) tabs, so
// each video opens in a small, unfocused popup window that is muted and closed
// afterwards. If the OS still hides it (for example it is fully covered), the
// runner reports "hidden" and the window is brought to the front for one retry.
async function runInWindow(win, videoId) {
  const tabId = win.tabs?.[0]?.id ?? null;
  if (tabId == null) return { status: "error", detail: "no tab" };
  try {
    await chrome.tabs.update(tabId, { muted: true });
  } catch {
    // not fatal: the runner also mutes the player
  }
  // The runner waits for the player itself, so a slow "complete" event is not fatal.
  await waitForTabComplete(tabId, 20000).catch(() => {});
  await chrome.scripting.executeScript({ target: { tabId }, files: ["mark-watched.js"] });
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (options) => window.__wlMarkWatched(options),
    args: [{ videoId }],
  });
  if (injection?.error) return { status: "error", detail: String(injection.error.message || injection.error) };
  return injection?.result || { status: "error", detail: "no result" };
}

async function markVideoWatched(videoId, watchBase) {
  let windowId = null;
  const work = (async () => {
    const win = await chrome.windows.create({
      url: `${watchBase}?v=${encodeURIComponent(videoId)}`,
      type: "popup",
      focused: false,
      width: 420,
      height: 300,
      left: 20,
      top: 20,
    });
    windowId = win.id ?? null;
    currentWindowId = windowId;
    let result = await runInWindow(win, videoId);
    if (result.status === "hidden" && windowId != null && !cancelRequested) {
      await chrome.windows.update(windowId, { focused: true });
      await chrome.tabs.reload(win.tabs[0].id);
      result = await runInWindow(win, videoId);
    }
    return result;
  })();

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ status: "timeout", detail: "per-video limit" }), PER_VIDEO_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      work.catch((error) => ({ status: "error", detail: error instanceof Error ? error.message : String(error) })),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
    await closeWindow(windowId);
    currentWindowId = null;
  }
}

async function saveJob(job) {
  await chrome.storage.local.set({ [JOB_KEY]: job });
}

async function runDoneSync() {
  const { apiUrl } = await getSettings();
  const stored = await chrome.storage.local.get(["watchBase"]);
  const watchBase = stored.watchBase || DEFAULT_WATCH_BASE;
  // Re-read the list at start so the confirmed count and the run agree.
  const [done, library, state] = await Promise.all([
    fetchJson(`${apiUrl}/api/done`),
    fetchJson(`${apiUrl}/api/library`),
    chrome.storage.local.get([SYNCED_KEY, SKIPPED_KEY]),
  ]);
  const { toSync } = selectDoneToSync({
    doneItems: done.items ?? [],
    videos: library.videos ?? [],
    synced: state[SYNCED_KEY] ?? {},
    skipped: state[SKIPPED_KEY] ?? {},
  });

  let job = initialJob(toSync);
  await saveJob(job);
  const keepAlive = setInterval(() => void chrome.runtime.getPlatformInfo(), 20000);
  try {
    for (const video of toSync) {
      if (cancelRequested) break;
      job = { ...job, current: { id: video.id, title: video.title }, cancelRequested };
      await saveJob(job);
      const result = await markVideoWatched(video.id, watchBase);
      if (cancelRequested && result.status !== "ok") {
        // The tab was closed by Cancel; do not count it as a failure.
        job = { ...job, cancelRequested: true };
        break;
      }
      job = recordResult(job, video, result);
      if (result.status === "ok") {
        const current = await chrome.storage.local.get([SYNCED_KEY]);
        await chrome.storage.local.set({
          [SYNCED_KEY]: { ...(current[SYNCED_KEY] ?? {}), [video.id]: Date.now() },
        });
      } else if (["live", "unavailable", "private", "age_restricted"].includes(result.status)) {
        const current = await chrome.storage.local.get([SKIPPED_KEY]);
        await chrome.storage.local.set({
          [SKIPPED_KEY]: { ...(current[SKIPPED_KEY] ?? {}), [video.id]: result.status },
        });
      }
      await saveJob(job);
    }
  } finally {
    clearInterval(keepAlive);
    job = finishJob({ ...job, cancelRequested });
    await saveJob(job);
    jobActive = false;
    cancelRequested = false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message?.type;
  if (!["DONE_SYNC_PREVIEW", "DONE_SYNC_START", "DONE_SYNC_CANCEL", "DONE_SYNC_CLEAR_SKIPPED"].includes(type)) {
    return undefined;
  }

  (async () => {
    if (type === "DONE_SYNC_PREVIEW") return previewDoneSync();
    if (type === "DONE_SYNC_CANCEL") {
      cancelRequested = true;
      await closeWindow(currentWindowId);
      return { ok: true };
    }
    if (type === "DONE_SYNC_CLEAR_SKIPPED") {
      await chrome.storage.local.remove([SKIPPED_KEY]);
      return { ok: true };
    }
    // DONE_SYNC_START: only with an explicit confirmation from the popup.
    if (message.confirmed !== true) throw new Error("Confirmation required.");
    if (jobActive) throw new Error("A Done sync is already running.");
    jobActive = true;
    cancelRequested = false;
    runDoneSync().catch(async (error) => {
      jobActive = false;
      await saveJob({
        state: "interrupted",
        total: 0,
        index: 0,
        current: null,
        ok: [],
        failed: [{ id: "-", reason: "error", detail: error instanceof Error ? error.message : String(error) }],
        skipped: [],
        cancelRequested: false,
        startedAt: Date.now(),
        finishedAt: Date.now(),
      });
    });
    return { ok: true };
  })()
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
  return true;
});
