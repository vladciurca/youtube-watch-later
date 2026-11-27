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
 * IDs whose last known library progress was Done (>= 95%) but a later YouTube
 * scrape came back below the threshold (for example an accidental reopen).
 */
export function regressedDoneIds(previousVideos, scrapedVideos) {
  const scrapedById = new Map();
  for (const video of Array.isArray(scrapedVideos) ? scrapedVideos : []) {
    if (video?.id) scrapedById.set(video.id, video);
  }
  const ids = [];
  const seen = new Set();
  for (const prev of Array.isArray(previousVideos) ? previousVideos : []) {
    if (!isVideoId(prev?.id) || seen.has(prev.id) || !isDonePct(prev.watchedPct)) continue;
    const scraped = scrapedById.get(prev.id);
    if (!scraped || isDonePct(scraped.watchedPct)) continue;
    seen.add(prev.id);
    ids.push(prev.id);
  }
  return ids;
}

/**
 * Merge a new regression list with the one stored in this browser: add new
 * regressions, and drop IDs whose latest scrape is once again >= 95%.
 */
export function mergeRegressedIds(previous, next, scrapedVideos) {
  const scrapedById = new Map();
  for (const video of Array.isArray(scrapedVideos) ? scrapedVideos : []) {
    if (video?.id) scrapedById.set(video.id, video);
  }
  const out = [];
  const seen = new Set();
  for (const id of [...(Array.isArray(previous) ? previous : []), ...(Array.isArray(next) ? next : [])]) {
    if (!isVideoId(id) || seen.has(id)) continue;
    const scraped = scrapedById.get(id);
    if (scraped && isDonePct(scraped.watchedPct)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Which of the app's Done videos should be pushed to YouTube.
 *
 * doneItems    : /api/done items [{ id, doneAt }]
 * videos       : /api/library videos
 * synced       : { [id]: timestamp } already pushed from this browser
 * skipped      : { [id]: reason } previously found unsyncable (live, private, ...)
 * regressedIds : auto-Done (or previously synced) IDs whose YouTube bar reset
 *
 * Order follows the Done list (oldest mark first), then flagged regressions
 * that are not already in that list. Videos YouTube already shows as watched
 * (>= 95% in the last library sync, and not flagged as reset) are skipped, as
 * are ones already synced (unless they have since reset), previously skipped,
 * or no longer in the library.
 */
export function selectDoneToSync({
  doneItems,
  videos,
  synced = {},
  skipped = {},
  regressedIds = [],
} = {}) {
  const byId = new Map();
  for (const video of Array.isArray(videos) ? videos : []) {
    if (video?.id) byId.set(video.id, video);
  }
  const regressed = new Set(
    (Array.isArray(regressedIds) ? regressedIds : []).filter((id) => isVideoId(id)),
  );
  const needsMark = (video) =>
    !!video && (video.needsYouTubeMarkWatched === true || regressed.has(video.id));
  const toSync = [];
  const counts = {
    alreadyWatched: 0,
    alreadySynced: 0,
    previouslySkipped: 0,
    notInLibrary: 0,
    invalid: 0,
  };
  const seen = new Set();

  const consider = (id) => {
    if (!isVideoId(id)) {
      counts.invalid += 1;
      return;
    }
    if (seen.has(id)) return;
    seen.add(id);
    const video = byId.get(id);
    if (!video) {
      counts.notInLibrary += 1;
      return;
    }
    const flagged = needsMark(video);
    // alreadySynced stays in force after a successful mark, even if the
    // library still has needsYouTubeMarkWatched from the last sync. Only a
    // later scrape (regressedIds) re-opens the video.
    if (isDonePct(video.watchedPct) && !flagged) {
      counts.alreadyWatched += 1;
      return;
    }
    if (synced[id] && !regressed.has(id)) {
      counts.alreadySynced += 1;
      return;
    }
    if (skipped[id]) {
      counts.previouslySkipped += 1;
      return;
    }
    toSync.push({ id, title: video.title || id });
  };

  for (const item of Array.isArray(doneItems) ? doneItems : []) {
    consider(typeof item === "string" ? item : item?.id);
  }
  for (const video of Array.isArray(videos) ? videos : []) {
    if (needsMark(video) && !seen.has(video.id)) consider(video.id);
  }
  for (const id of regressed) {
    if (!seen.has(id)) consider(id);
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
