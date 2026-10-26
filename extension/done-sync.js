// Pure logic for "Sync Done to YouTube". No chrome.* or DOM access here so it
// can be unit-tested in Node and imported by the service worker and the popup.

// Same threshold as the app (api/_lib/threshold.mjs): 95% watched counts as Done.
export const DONE_THRESHOLD_PCT = 95;

/** Page-runner result statuses that mean "nothing to do for this video" (not a failure). */
export const SKIP_STATUSES = new Set([
  "live",
  "unavailable",
  "private",
  "age_restricted",
]);

export function isVideoId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{11}$/.test(id);
}

function isDonePct(pct) {
  return typeof pct === "number" && Number.isFinite(pct) && pct >= DONE_THRESHOLD_PCT;
}

/**
 * Which of the app's Done videos should be pushed to YouTube.
 *
 * doneItems  : /api/done items [{ id, doneAt }]
 * videos     : /api/library videos
 * synced     : { [id]: timestamp } already pushed from this browser
 * skipped    : { [id]: reason } previously found unsyncable (live, private, ...)
 *
 * Order follows the Done list (oldest mark first). Videos YouTube already shows
 * as watched (>= 95% in the last library sync) are skipped, as are ones already
 * synced, previously skipped, or no longer in the library.
 */
export function selectDoneToSync({ doneItems, videos, synced = {}, skipped = {} }) {
  const byId = new Map();
  for (const video of Array.isArray(videos) ? videos : []) {
    if (video?.id) byId.set(video.id, video);
  }
  const toSync = [];
  const counts = {
    alreadyWatched: 0,
    alreadySynced: 0,
    previouslySkipped: 0,
    notInLibrary: 0,
    invalid: 0,
  };
  const seen = new Set();
  for (const item of Array.isArray(doneItems) ? doneItems : []) {
    const id = typeof item === "string" ? item : item?.id;
    if (!isVideoId(id)) {
      counts.invalid += 1;
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const video = byId.get(id);
    if (!video) {
      counts.notInLibrary += 1;
      continue;
    }
    if (isDonePct(video.watchedPct)) {
      counts.alreadyWatched += 1;
      continue;
    }
    if (synced[id]) {
      counts.alreadySynced += 1;
      continue;
    }
    if (skipped[id]) {
      counts.previouslySkipped += 1;
      continue;
    }
    toSync.push({ id, title: video.title || id });
  }
  return { toSync, counts };
}

/** Where to seek: a few seconds before the end, never before 0. */
export function seekTarget(durationSec, beforeEndSec = 4) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return Math.max(0, durationSec - beforeEndSec);
}

export function initialJob(toSync, now = Date.now()) {
  return {
    state: "running",
    total: toSync.length,
    index: 0,
    current: null,
    ok: [],
    failed: [],
    skipped: [],
    cancelRequested: false,
    startedAt: now,
    finishedAt: null,
  };
}

/** Fold one page-runner result into the job. Pure; returns a new job. */
export function recordResult(job, video, result) {
  const status = result?.status || "error";
  const next = { ...job, ok: [...job.ok], failed: [...job.failed], skipped: [...job.skipped] };
  if (status === "ok") next.ok.push(video.id);
  else if (SKIP_STATUSES.has(status)) next.skipped.push({ id: video.id, reason: status });
  else next.failed.push({ id: video.id, reason: status, detail: result?.detail || "" });
  next.index = job.index + 1;
  return next;
}

export function finishJob(job, now = Date.now()) {
  const cancelled = job.cancelRequested === true && job.index < job.total;
  return { ...job, state: cancelled ? "cancelled" : "finished", current: null, finishedAt: now };
}

const REASON_LABELS = {
  live: "live stream",
  unavailable: "unavailable",
  private: "private",
  age_restricted: "age-restricted",
  timeout: "timed out",
  ad_timeout: "ad did not finish",
  stalled: "playback did not start",
  hidden: "window stayed hidden (Chrome does not load video in hidden windows)",
  navigated: "YouTube moved to another video",
  error: "error",
};

export function reasonLabel(reason) {
  return REASON_LABELS[reason] || reason || "error";
}

export function summarizeJob(job) {
  if (!job || job.state === "idle") return "";
  const parts = [`${job.ok.length} synced`];
  if (job.skipped.length) parts.push(`${job.skipped.length} skipped`);
  if (job.failed.length) parts.push(`${job.failed.length} failed`);
  if (job.state === "running") {
    const n = Math.min(job.total, job.index + 1);
    return `Video ${n} of ${job.total} · ${parts.join(", ")}`;
  }
  const head =
    job.state === "cancelled"
      ? `Cancelled after ${job.index} of ${job.total}`
      : job.state === "interrupted"
        ? `Interrupted after ${job.index} of ${job.total}`
        : `Done: ${job.total} checked`;
  return `${head} · ${parts.join(", ")}`;
}
