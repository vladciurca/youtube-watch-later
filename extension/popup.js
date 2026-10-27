import { describeLastRun, isAutoDoneEnabled, isAutoEnabled } from "./auto-sync.js";
import { reasonLabel, summarizeJob } from "./done-sync.js";

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

// ---------------------------------------------------------------------------
// Sync Done to YouTube (manual; always asks before starting)
// ---------------------------------------------------------------------------

const JOB_KEY = "doneSyncJob";
const SKIPPED_KEY = "doneSyncSkipped";
const doneSyncButton = document.getElementById("doneSync");
const doneConfirm = document.getElementById("doneConfirm");
const doneConfirmText = document.getElementById("doneConfirmText");
const doneStart = document.getElementById("doneStart");
const doneCancelConfirm = document.getElementById("doneCancelConfirm");
const doneProgress = document.getElementById("doneProgress");
const doneProgressText = document.getElementById("doneProgressText");
const doneCancel = document.getElementById("doneCancel");
const doneRetry = document.getElementById("doneRetry");

function describeJob(job) {
  let text = summarizeJob(job);
  if (job.state === "running" && job.current?.title) {
    text += `\nNow: ${job.current.title}`;
  }
  if (job.state !== "running") {
    if (job.total === 0 && job.failed[0]?.detail) text = `Could not start: ${job.failed[0].detail}`;
    const details = [...job.failed, ...job.skipped]
      .slice(0, 4)
      .map((item) => `${item.id}: ${reasonLabel(item.reason)}`);
    if (details.length) text += `\n${details.join("\n")}`;
  }
  return text;
}

async function renderDoneJob() {
  const stored = await chrome.storage.local.get([JOB_KEY, SKIPPED_KEY]);
  const job = stored[JOB_KEY];
  const running = job?.state === "running";
  doneProgress.hidden = !job || job.state === "idle";
  doneProgressText.style.whiteSpace = "pre-line";
  doneProgressText.textContent = job ? describeJob(job) : "";
  doneCancel.hidden = !running;
  doneSyncButton.disabled = running;
  const skippedCount = Object.keys(stored[SKIPPED_KEY] ?? {}).length;
  doneRetry.hidden = running || skippedCount === 0;
  doneRetry.textContent = `Retry ${skippedCount} skipped video${skippedCount === 1 ? "" : "s"}`;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[JOB_KEY] || changes[SKIPPED_KEY])) void renderDoneJob();
});
await renderDoneJob();

doneSyncButton.addEventListener("click", async () => {
  await persist();
  doneSyncButton.disabled = true;
  doneConfirm.hidden = true;
  setStatus("Checking which Done videos still need syncing…");
  try {
    const preview = await chrome.runtime.sendMessage({ type: "DONE_SYNC_PREVIEW" });
    if (!preview?.ok) throw new Error(preview?.error || "Could not read the Done list");
    if (preview.count === 0) {
      setStatus(
        `Nothing to sync. ${preview.totalDone} marked Done in the library; the rest are already watched on YouTube, already synced, or skipped.`,
        "ok",
      );
      return;
    }
    const c = preview.counts;
    const skipNote = [
      c.alreadyWatched ? `${c.alreadyWatched} already watched` : "",
      c.alreadySynced ? `${c.alreadySynced} already synced` : "",
      c.previouslySkipped ? `${c.previouslySkipped} skipped before` : "",
    ]
      .filter(Boolean)
      .join(", ");
    doneConfirmText.textContent =
      `Mark ${preview.count} video${preview.count === 1 ? "" : "s"} as watched on YouTube?` +
      (skipNote ? ` (Skipping ${skipNote}.)` : "") +
      " Each one opens in a small muted window for about 15–30 seconds, one at a time, then closes. Please do not use that window.";
    doneConfirm.hidden = false;
    setStatus("");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    doneSyncButton.disabled = false;
    void renderDoneJob();
  }
});

doneCancelConfirm.addEventListener("click", () => {
  doneConfirm.hidden = true;
});

doneStart.addEventListener("click", async () => {
  doneConfirm.hidden = true;
  setStatus("Starting…");
  try {
    const result = await chrome.runtime.sendMessage({ type: "DONE_SYNC_START", confirmed: true });
    if (!result?.ok) throw new Error(result?.error || "Could not start");
    setStatus("");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  }
});

doneCancel.addEventListener("click", async () => {
  doneCancel.disabled = true;
  await chrome.runtime.sendMessage({ type: "DONE_SYNC_CANCEL" });
  doneCancel.disabled = false;
});

doneRetry.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "DONE_SYNC_CLEAR_SKIPPED" });
  setStatus("Skipped videos will be included next time. Click Sync Done to YouTube.");
});

// ---------------------------------------------------------------------------
// Automatic daily sync (toggle, Run now, last result)
// ---------------------------------------------------------------------------

const AUTO_STATE_KEY = "autoSync";
const AUTO_LOCK_KEY = "autoSyncLockAt";
const autoEnabled = document.getElementById("autoEnabled");
const autoDone = document.getElementById("autoDone");
const autoRun = document.getElementById("autoRun");
const autoStatus = document.getElementById("autoStatus");

async function renderAuto() {
  const stored = await chrome.storage.local.get([
    AUTO_STATE_KEY,
    AUTO_LOCK_KEY,
    "autoSyncEnabled",
    "autoDoneEnabled",
  ]);
  autoEnabled.checked = isAutoEnabled(stored.autoSyncEnabled);
  autoDone.checked = isAutoDoneEnabled(stored.autoDoneEnabled);
  autoDone.disabled = !autoEnabled.checked;
  const running = !!stored[AUTO_LOCK_KEY] && Date.now() - stored[AUTO_LOCK_KEY] < 20 * 60 * 1000;
  autoRun.disabled = running;
  autoStatus.textContent = running
    ? "Running now… (uses an inactive tab; this can take a minute)"
    : describeLastRun(stored[AUTO_STATE_KEY]);
}

autoEnabled.addEventListener("change", async () => {
  await chrome.storage.local.set({ autoSyncEnabled: autoEnabled.checked });
  await renderAuto();
});
autoDone.addEventListener("change", async () => {
  await chrome.storage.local.set({ autoDoneEnabled: autoDone.checked });
});
autoRun.addEventListener("click", async () => {
  await persist();
  autoRun.disabled = true;
  await chrome.runtime.sendMessage({ type: "AUTO_RUN_NOW" });
  setTimeout(() => void renderAuto(), 500);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (
    area === "local" &&
    (changes[AUTO_STATE_KEY] || changes[AUTO_LOCK_KEY] || changes.autoSyncEnabled || changes.autoDoneEnabled)
  ) {
    void renderAuto();
  }
});
await renderAuto();
