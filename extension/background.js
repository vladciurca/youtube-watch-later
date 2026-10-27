import {
  AUTO_DONE_CAP,
  describeDoneStep,
  describeSkippedManual,
  describeSyncFailure,
  describeSyncResult,
  hasSyncSecret,
  isAutoDoneEnabled,
  isAutoEnabled,
  recordAttempt,
  recordCheck,
  recordRunStart,
  recoverInterruptedState,
  shouldRunAuto,
} from "./auto-sync.js";
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
    syncSecret: hasSyncSecret(stored.syncSecret) ? stored.syncSecret.trim() : "",
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

// Resolves when the tab has finished loading. The listener goes on before
// anything is inspected, so a load that finishes immediately is never missed,
// and the current status is checked too in case it finished before this call.
// `fresh` skips that check to wait for the *next* completion (after a reload).
function waitForTabComplete(tabId, timeoutMs, { fresh = false, what = "page" } = {}) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const done = (fn, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      fn(value);
    };
    const timer = setTimeout(() => done(reject, new Error(`${what} load timed out`)), timeoutMs);
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") done(resolve);
    };
    chrome.tabs.onUpdated.addListener(listener);
    if (fresh) return;
    chrome.tabs.get(tabId).then(
      // A tab the browser put to sleep reports "unloaded" and never fires
      // "complete" on its own, so it must not be treated as ready.
      (tab) => {
        if (tab.status === "complete" && tab.discarded !== true) done(resolve);
      },
      (error) => done(reject, error),
    );
  });
}

const WL_LOAD_TIMEOUT_MS = 45000;

// background = unattended run: reuse an open Watch Later tab without focusing it,
// or open one inactive. `created` tells the caller to close it afterwards.
async function findOrOpenWatchLater({ background = false } = {}) {
  const tabs = await chrome.tabs.query({
    url: ["https://www.youtube.com/playlist*", "https://youtube.com/playlist*"],
  });
  const existing = tabs.find(isWatchLaterTab);
  if (existing?.id != null) {
    if (!background) await chrome.tabs.update(existing.id, { active: true });
    // A Watch Later tab left open (or put to sleep) still holds the
    // ytInitialData from whenever it loaded, so videos added since then would
    // be invisible to the scrape. Always reload a tab we did not just open.
    // The wait is started first so the reload's "complete" cannot be missed.
    await Promise.all([
      waitForTabComplete(existing.id, WL_LOAD_TIMEOUT_MS, { fresh: true, what: "Watch Later" }),
      chrome.tabs.reload(existing.id),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return { tabId: existing.id, created: false };
  }

  const created = await chrome.tabs.create({ url: WL_URL, active: !background });
  if (created.id == null) throw new Error("Could not open Watch Later");
  await waitForTabComplete(created.id, WL_LOAD_TIMEOUT_MS, { what: "Watch Later" });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  return { tabId: created.id, created: true };
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
    const error = new Error(payload.error || `Sync failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

// The normal scrape + upload. `background` is used by unattended runs.
async function performWatchLaterSync({ background = false } = {}) {
  let tabId = null;
  let created = false;
  try {
    const { apiUrl, syncSecret } = await getSettings();
    if (!syncSecret) {
      throw new Error("Set the sync secret in this popup (same value as Vercel SYNC_SECRET).");
    }
    const [opened, expectedCount] = await Promise.all([
      findOrOpenWatchLater({ background }),
      previousOnListCount(apiUrl),
    ]);
    tabId = opened.tabId;
    created = opened.created;
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/consent\.youtube|accounts\.google|Cannot access contents|signin/i.test(message)) {
      throw new Error(
        "YouTube is not signed in (or is showing a consent page) in this browser, so Watch Later could not be read. Nothing was uploaded.",
      );
    }
    throw new Error(describeSyncFailure(error));
  } finally {
    if (background && created && tabId != null) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        // already closed
      }
    }
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SYNC_WATCH_LATER") return undefined;

  performWatchLaterSync()
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

async function runDoneSync({ maxVideos = Infinity } = {}) {
  const { apiUrl } = await getSettings();
  const stored = await chrome.storage.local.get(["watchBase"]);
  const watchBase = stored.watchBase || DEFAULT_WATCH_BASE;
  // Re-read the list at start so the confirmed count and the run agree.
  const [done, library, state] = await Promise.all([
    fetchJson(`${apiUrl}/api/done`),
    fetchJson(`${apiUrl}/api/library`),
    chrome.storage.local.get([SYNCED_KEY, SKIPPED_KEY]),
  ]);
  const { toSync: allToSync } = selectDoneToSync({
    doneItems: done.items ?? [],
    videos: library.videos ?? [],
    synced: state[SYNCED_KEY] ?? {},
    skipped: state[SKIPPED_KEY] ?? {},
  });
  // Unattended runs cap how many videos they touch; the rest wait for the next run.
  const toSync = allToSync.slice(0, maxVideos);

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
  return job;
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

// ---------------------------------------------------------------------------
// Automatic daily sync. An hourly alarm checks whether a successful run is more
// than ~20 h old; a startup alarm catches up after the browser was closed.
// Every run: (1) the normal scrape + upload in an inactive tab, (2) optionally,
// only if the user switched it on, the capped Done-to-YouTube step.
// ---------------------------------------------------------------------------

const AUTO_ALARM = "autoSyncCheck";
const AUTO_STARTUP_ALARM = "autoSyncStartup";
const AUTO_STATE_KEY = "autoSync";
const AUTO_LOCK_KEY = "autoSyncLockAt";
const AUTO_ENABLED_KEY = "autoSyncEnabled";
const AUTO_DONE_KEY = "autoDoneEnabled";

// A service worker restart kills in-flight work. A Done job must not stay
// "running", and an auto-sync lock (or a start with no result) means the run
// died before the library accepted a POST. Record that, or the popup keeps
// showing the previous line and Run now looks like it never happened.
const booted = (async () => {
  const stored = await chrome.storage.local.get([JOB_KEY, AUTO_STATE_KEY, AUTO_LOCK_KEY]);
  const job = stored[JOB_KEY];
  if (job?.state === "running") {
    await chrome.storage.local.set({
      [JOB_KEY]: { ...job, state: "interrupted", current: null, finishedAt: Date.now() },
    });
  }
  const recovered = recoverInterruptedState(stored[AUTO_STATE_KEY], stored[AUTO_LOCK_KEY], Date.now());
  if (recovered) {
    await chrome.storage.local.set({ [AUTO_STATE_KEY]: recovered });
    await chrome.storage.local.remove([AUTO_LOCK_KEY]);
  }
})();

async function ensureAlarms() {
  const existing = await chrome.alarms.get(AUTO_ALARM);
  if (!existing) {
    // Alarms may be dropped when the browser restarts, so this runs on every worker start.
    chrome.alarms.create(AUTO_ALARM, { delayInMinutes: 5, periodInMinutes: 60 });
  }
}

async function runAuto(trigger, { force = false } = {}) {
  // Extension API calls keep the worker alive after the popup closes. Start
  // this before the first await so a Run now cannot die as "never started".
  const keepAlive = setInterval(() => void chrome.runtime.getPlatformInfo(), 20000);
  try {
    await booted;
    const stored = await chrome.storage.local.get([
      AUTO_STATE_KEY,
      AUTO_LOCK_KEY,
      AUTO_ENABLED_KEY,
      AUTO_DONE_KEY,
      "syncSecret",
    ]);
    const now = Date.now();
    const decision = shouldRunAuto({
      enabled: isAutoEnabled(stored[AUTO_ENABLED_KEY]),
      now,
      auto: stored[AUTO_STATE_KEY],
      lockAt: stored[AUTO_LOCK_KEY],
      hasSecret: hasSyncSecret(stored.syncSecret),
      force,
    });
    if (!decision.run) {
      // Even a cheap skipped check is written down, so the popup can say why
      // nothing ran instead of looking like auto-sync never started.
      // A live run already holds the lock: do not overwrite its result with
      // "did not start", or the click races the run that is about to finish.
      let state = recordCheck(stored[AUTO_STATE_KEY], { now, reason: decision.reason });
      let text = "";
      if ((force || trigger === "manual") && decision.reason !== "running") {
        text = describeSkippedManual(decision.reason);
        state = recordAttempt(state, { ok: false, text, now, trigger });
      } else if (decision.reason === "running") {
        text = describeSkippedManual("running");
      }
      await chrome.storage.local.set({ [AUTO_STATE_KEY]: state });
      return { ok: false, skipped: decision.reason, text };
    }

    await chrome.storage.local.set({
      [AUTO_LOCK_KEY]: now,
      [AUTO_STATE_KEY]: recordRunStart(stored[AUTO_STATE_KEY], { now, trigger }),
    });
    let ok = false;
    let partial = false;
    let text = "";
    try {
      const result = await performWatchLaterSync({ background: true });
      ok = true;
      // An incomplete scrape uploaded fine but did not read the whole playlist,
      // so it is retried on the short backoff instead of 20 h later.
      partial = result.partial === true;
      text = `Sync: ${describeSyncResult(result)}`;
      if (isAutoDoneEnabled(stored[AUTO_DONE_KEY])) {
        if (jobActive) {
          text += ". Done step skipped: another Done sync is running";
        } else {
          try {
            jobActive = true;
            cancelRequested = false;
            const job = await runDoneSync({ maxVideos: AUTO_DONE_CAP });
            text += `. ${describeDoneStep(job)}`;
          } catch (error) {
            jobActive = false;
            text += `. Done step failed: ${describeSyncFailure(error)}`;
          }
        }
      }
    } catch (error) {
      text = describeSyncFailure(error);
    } finally {
      const latest = await chrome.storage.local.get([AUTO_STATE_KEY]);
      await chrome.storage.local.set({
        [AUTO_STATE_KEY]: recordAttempt(latest[AUTO_STATE_KEY], { ok, partial, text, now: Date.now(), trigger }),
      });
      await chrome.storage.local.remove([AUTO_LOCK_KEY]);
    }
    return { ok, partial, text };
  } finally {
    clearInterval(keepAlive);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_ALARM) void runAuto("daily");
  if (alarm.name === AUTO_STARTUP_ALARM) void runAuto("startup");
});

chrome.runtime.onInstalled.addListener(() => {
  void ensureAlarms();
  chrome.alarms.create(AUTO_STARTUP_ALARM, { delayInMinutes: 1 });
});

chrome.runtime.onStartup.addListener(() => {
  void ensureAlarms();
  // Catch up shortly after the browser opens if the last good run is over ~20 h old.
  chrome.alarms.create(AUTO_STARTUP_ALARM, { delayInMinutes: 1 });
});

void ensureAlarms();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "AUTO_RUN_NOW") return undefined;
  // Stay alive until the run records a result. Returning true keeps the
  // message channel open, which is what stops Arc from suspending the worker
  // the moment the popup's listener returns.
  runAuto("manual", { force: true })
    .then((result) => {
      try {
        sendResponse(result);
      } catch {
        // The popup was closed; the result is already in storage.
      }
    })
    .catch((error) => {
      const text = describeSyncFailure(error);
      try {
        sendResponse({ ok: false, error: text, text });
      } catch {
        // popup closed
      }
    });
  return true;
});
