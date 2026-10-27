// Pure rules for the unattended daily sync. No chrome.* access so they can be
// unit-tested in Node and shared by the service worker and the popup.

const HOUR = 60 * 60 * 1000;
export const AUTO_MIN_INTERVAL_MS = 20 * HOUR; // a successful run is due again after this
export const AUTO_RETRY_MS = 2 * HOUR; // wait this long after a failed attempt
export const AUTO_MAX_FAILS = 3; // after this many failures in a row, wait a full interval
export const AUTO_DONE_CAP = 5; // most videos the unattended Done step touches per run
export const AUTO_STALE_LOCK_MS = 20 * 60 * 1000; // a lock older than this is a dead run

/** Auto-sync is on unless the user turned it off. */
export function isAutoEnabled(value) {
  return value !== false;
}

/** The unattended Done step is opt-in. */
export function isAutoDoneEnabled(value) {
  return value === true;
}

function past(ts, now) {
  // Ignore missing timestamps and ones from the future (clock changes).
  return typeof ts === "number" && Number.isFinite(ts) && ts > 0 && ts <= now + 60 * 1000 ? ts : 0;
}

/**
 * Decide whether an automatic run should start now. Never loops: after a
 * failure it waits 2 h, and after 3 failures in a row a full 20 h.
 */
export function shouldRunAuto({ enabled, now, auto, lockAt, hasSecret, force = false }) {
  const state = auto || {};
  const lock = past(lockAt, now);
  if (lock && now - lock < AUTO_STALE_LOCK_MS) return { run: false, reason: "running" };
  if (!hasSecret) return { run: false, reason: "no_secret" };
  if (force) return { run: true, reason: "manual" };
  if (!enabled) return { run: false, reason: "disabled" };
  const lastOk = past(state.lastSuccessAt, now);
  if (lastOk && now - lastOk < AUTO_MIN_INTERVAL_MS) return { run: false, reason: "fresh" };
  const lastTry = past(state.lastAttemptAt, now);
  const wait = (state.failedStreak ?? 0) >= AUTO_MAX_FAILS ? AUTO_MIN_INTERVAL_MS : AUTO_RETRY_MS;
  if (lastTry && now - lastTry < wait) return { run: false, reason: "backoff" };
  return { run: true, reason: "due" };
}

/** Fold the outcome of one attempt into the stored auto-sync state. */
export function recordAttempt(auto, { ok, text, now, trigger }) {
  const prev = auto || {};
  return {
    lastAttemptAt: now,
    lastSuccessAt: ok ? now : (prev.lastSuccessAt ?? null),
    failedStreak: ok ? 0 : (prev.failedStreak ?? 0) + 1,
    lastResult: { ok: !!ok, text: String(text || ""), at: now, trigger: trigger || "daily" },
  };
}

/** One line for the popup: when it last ran and how it went. */
export function describeLastRun(auto, now = Date.now()) {
  const result = auto?.lastResult;
  if (!result) return "Auto-sync has not run yet.";
  const mins = Math.max(0, Math.round((now - result.at) / 60000));
  const ago =
    mins < 1
      ? "just now"
      : mins < 90
        ? `${mins} min ago`
        : mins < 48 * 60
          ? `${Math.round(mins / 60)} h ago`
          : `${Math.round(mins / 1440)} days ago`;
  return `Last run ${ago} (${result.ok ? "ok" : "failed"}): ${result.text}`;
}

/** Text for the sync part of a run, from the /api/sync response. */
export function describeSyncResult(result) {
  const scraped = result?.scraped ?? result?.upserted ?? 0;
  const dropped = result?.dropped ?? 0;
  return result?.partial
    ? `scraped ${scraped}, looked incomplete so nothing was dropped`
    : `scraped ${scraped}, ${dropped} marked Dropped`;
}

/** Text for the optional Done step, from the finished job. */
export function describeDoneStep(job) {
  if (!job) return "Done step did not run";
  const parts = [`${job.ok?.length ?? 0} marked watched`];
  if (job.skipped?.length) parts.push(`${job.skipped.length} skipped`);
  if (job.failed?.length) parts.push(`${job.failed.length} failed`);
  return `Done step: ${parts.join(", ")}`;
}
