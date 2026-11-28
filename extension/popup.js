import {
  AUTO_STALE_LOCK_MS,
  LEGACY_AUTO_DONE_KEY,
  MARK_DONE_KEY,
  describeAutoStatus,
  describeMarkingStatus,
  describeSyncFailure,
  hasSyncSecret,
  isAutoEnabled,
  resolveMarkDoneSetting,
} from "./auto-sync.js";
import { POPUP_WIDTH, popupZoomForViewport } from "./popup-fit.js";

function fitPopupToViewport() {
  const root = document.documentElement;
  root.style.zoom = "";
  const zoom = popupZoomForViewport({
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    layoutWidth: Math.max(root.scrollWidth, POPUP_WIDTH),
    layoutHeight: root.scrollHeight,
  });
  root.style.zoom = zoom;
}

fitPopupToViewport();
window.addEventListener("resize", fitPopupToViewport);

const DEFAULT_API = "https://youtube-watch-later.vercel.app";

const apiUrl = document.getElementById("apiUrl");
const syncSecret = document.getElementById("syncSecret");
const syncButton = document.getElementById("sync");
const status = document.getElementById("status");
const doneCancel = document.getElementById("doneCancel");

function setStatus(text, kind) {
  status.textContent = text;
  status.classList.toggle("is-error", kind === "error");
  status.classList.toggle("is-ok", kind === "ok");
  fitPopupToViewport();
}

const RESET_DROPPED_PENDING_KEY = "resetDroppedPending";
const JOB_KEY = "doneSyncJob";

const stored = await chrome.storage.local.get([
  "apiUrl",
  "syncSecret",
  RESET_DROPPED_PENDING_KEY,
  MARK_DONE_KEY,
  LEGACY_AUTO_DONE_KEY,
]);
apiUrl.value = stored.apiUrl || DEFAULT_API;
syncSecret.value = stored.syncSecret || "";
let resetPending = stored[RESET_DROPPED_PENDING_KEY] !== false;
if (resetPending) {
  setStatus(
    "Next sync restores videos marked Dropped after the first-page-only scrape. A full Watch Later scrape then marks Dropped only for videos missing from YouTube.",
  );
}

const migratedMark = resolveMarkDoneSetting(stored);
if (migratedMark.migrated) await chrome.storage.local.set(migratedMark.migrated);

async function persist() {
  await chrome.storage.local.set({
    apiUrl: apiUrl.value.trim() || DEFAULT_API,
    syncSecret: syncSecret.value.trim(),
  });
}

apiUrl.addEventListener("change", () => void persist());
syncSecret.addEventListener("change", () => void persist());

function formatScrapeStatus(result) {
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
  return result.partial
    ? `${restored}Scraped ${scrapedCount}${ofStated}${method}. The scrape looked incomplete, so previous Watch Later entries were kept. Sync again, then refresh the library.`
    : `${restored}Scraped ${scrapedCount}${ofStated}${method}. ${result.dropped} marked Dropped. Refresh the library.`;
}

let lastScrapeStatus = "";
let lastScrapeKind = "";

function showScrapeAndMarking(job, markingCount) {
  const parts = [];
  if (lastScrapeStatus) parts.push(lastScrapeStatus);
  const marking =
    describeMarkingStatus(job) ||
    (markingCount > 0 && (!job || job.state === "idle" || job.state === "running")
      ? `Marking ${markingCount} watched…`
      : job?.state === "running"
        ? "Marking watched…"
        : "");
  if (marking) parts.push(marking);
  if (parts.length) setStatus(parts.join("\n"), lastScrapeKind || undefined);
  doneCancel.hidden = job?.state !== "running";
  fitPopupToViewport();
}

syncButton.addEventListener("click", async () => {
  await persist();
  syncButton.disabled = true;
  doneCancel.hidden = true;
  let holdForMarking = false;
  setStatus(
    resetPending
      ? "Opening Watch Later… Restoring Dropped from the incomplete first-page scrape, then merging."
      : "Opening Watch Later and scraping progress…",
  );
  try {
    const result = await chrome.runtime.sendMessage({ type: "SYNC_NOW" });
    if (!result) {
      throw new Error("Run never started");
    }
    if (result.ok === false) {
      lastScrapeStatus = "";
      lastScrapeKind = "error";
      setStatus(result.text || result.error || "Sync now failed before the library accepted it.", "error");
      return;
    }
    if (result.scraped != null || result.upserted != null || result.method) {
      lastScrapeStatus = formatScrapeStatus(result);
      lastScrapeKind = result.partial ? "error" : "ok";
    } else if (result.text) {
      lastScrapeStatus = result.text;
      lastScrapeKind = result.partial ? "error" : "ok";
    }
    const jobStored = await chrome.storage.local.get([JOB_KEY]);
    showScrapeAndMarking(jobStored[JOB_KEY], result.markingCount || 0);
    if (result.marking || (result.markingCount || 0) > 0) {
      // Keep the button disabled while the Done step is in flight, even if
      // the job has not been written to storage yet.
      holdForMarking = true;
      return;
    }
  } catch (error) {
    lastScrapeStatus = "";
    lastScrapeKind = "error";
    setStatus(describeSyncFailure(error), "error");
  } finally {
    const jobStored = await chrome.storage.local.get([JOB_KEY]);
    if (!holdForMarking && jobStored[JOB_KEY]?.state !== "running") {
      syncButton.disabled = false;
    }
  }
});

doneCancel.addEventListener("click", async () => {
  doneCancel.disabled = true;
  await chrome.runtime.sendMessage({ type: "DONE_SYNC_CANCEL" });
  doneCancel.disabled = false;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[JOB_KEY]) return;
  const job = changes[JOB_KEY].newValue;
  showScrapeAndMarking(job);
  if (job?.state !== "running") syncButton.disabled = false;
});

// ---------------------------------------------------------------------------
// Automatic daily sync (toggle, schedule, last result)
// ---------------------------------------------------------------------------

const AUTO_STATE_KEY = "autoSync";
const AUTO_LOCK_KEY = "autoSyncLockAt";
const autoEnabled = document.getElementById("autoEnabled");
const markDone = document.getElementById("markDone");
const autoStatus = document.getElementById("autoStatus");

async function renderAuto() {
  const stored = await chrome.storage.local.get([
    AUTO_STATE_KEY,
    AUTO_LOCK_KEY,
    "autoSyncEnabled",
    MARK_DONE_KEY,
    LEGACY_AUTO_DONE_KEY,
    "syncSecret",
  ]);
  autoEnabled.checked = isAutoEnabled(stored.autoSyncEnabled);
  const resolved = resolveMarkDoneSetting(stored);
  if (resolved.migrated) await chrome.storage.local.set(resolved.migrated);
  markDone.checked = resolved.enabled;
  autoStatus.style.whiteSpace = "pre-line";
  const lastResult = stored[AUTO_STATE_KEY]?.lastResult;
  autoStatus.classList.toggle("is-error", !!lastResult && lastResult.ok === false && !lastResult.pending);
  autoStatus.textContent = describeAutoStatus({
    enabled: autoEnabled.checked,
    // Only whether a secret exists, never its value.
    hasSecret: hasSyncSecret(stored.syncSecret || syncSecret.value),
    auto: stored[AUTO_STATE_KEY],
    lockAt: stored[AUTO_LOCK_KEY],
  });
  const running = !!stored[AUTO_LOCK_KEY] && Date.now() - stored[AUTO_LOCK_KEY] < AUTO_STALE_LOCK_MS;
  if (running) syncButton.disabled = true;
  const jobStored = await chrome.storage.local.get([JOB_KEY]);
  if (jobStored[JOB_KEY]?.state === "running") {
    syncButton.disabled = true;
    showScrapeAndMarking(jobStored[JOB_KEY]);
  }
  fitPopupToViewport();
}

autoEnabled.addEventListener("change", async () => {
  await chrome.storage.local.set({ autoSyncEnabled: autoEnabled.checked });
  await renderAuto();
});
markDone.addEventListener("change", async () => {
  await chrome.storage.local.set({ [MARK_DONE_KEY]: markDone.checked });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (
    area === "local" &&
    (changes[AUTO_STATE_KEY] ||
      changes[AUTO_LOCK_KEY] ||
      changes.autoSyncEnabled ||
      changes[MARK_DONE_KEY] ||
      changes[LEGACY_AUTO_DONE_KEY] ||
      changes.syncSecret)
  ) {
    void renderAuto();
  }
});
await renderAuto();
