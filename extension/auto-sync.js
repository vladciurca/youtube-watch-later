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
 * How long an attempt has to age before the next one is allowed. Normally the
 * 2 h retry; after 3 failures (or 3 incomplete scrapes) in a row, a full 20 h
 * so a browser that can never finish a scrape is not retried all day.
 */
export function retryWaitMs(auto) {
  const state = auto || {};
  const stalled =
    (state.failedStreak ?? 0) >= AUTO_MAX_FAILS || (state.partialStreak ?? 0) >= AUTO_MAX_FAILS;
  return stalled ? AUTO_MIN_INTERVAL_MS : AUTO_RETRY_MS;
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
  if (lastTry && now - lastTry < retryWaitMs(state)) return { run: false, reason: "backoff" };
  return { run: true, reason: "due" };
}

/**
 * When the next automatic run becomes due, by the same rules as shouldRunAuto
 * (a lock only delays it by minutes, so it is not counted). null when nothing
 * is scheduled at all: auto-sync off, or no secret to sync with.
 */
export function nextDueAt({ enabled, now, auto, hasSecret }) {
  if (!hasSecret || !enabled) return null;
  const state = auto || {};
  const lastOk = past(state.lastSuccessAt, now);
  const lastTry = past(state.lastAttemptAt, now);
  let due = now;
  if (lastOk) due = Math.max(due, lastOk + AUTO_MIN_INTERVAL_MS);
  if (lastTry) due = Math.max(due, lastTry + retryWaitMs(state));
  return due;
}

/**
 * Fold the outcome of one attempt into the stored auto-sync state. A scrape
 * the server judged partial uploaded fine but did not read the whole playlist,
 * so it does not count as a completed sync and does not defer the next run by
 * the full interval.
 */
export function recordAttempt(auto, { ok, partial = false, text, now, trigger }) {
  const prev = auto || {};
  const complete = !!ok && !partial;
  return {
    ...prev,
    lastAttemptAt: now,
    lastCheckAt: now,
    lastSkipReason: null,
    lastSuccessAt: complete ? now : (prev.lastSuccessAt ?? null),
    partialStreak: ok ? (partial ? (prev.partialStreak ?? 0) + 1 : 0) : (prev.partialStreak ?? 0),
    failedStreak: ok ? 0 : (prev.failedStreak ?? 0) + 1,
    lastResult: {
      ok: !!ok,
      partial: !!partial,
      text: String(text || ""),
      at: now,
      trigger: trigger || "daily",
    },
  };
}

/**
 * Note a cheap check that decided not to run. Keeping the reason is what lets
 * the popup tell "never ran" from "ran hourly and kept skipping".
 */
export function recordCheck(auto, { now, reason }) {
  return { ...(auto || {}), lastCheckAt: now, lastSkipReason: reason || null };
}

const SKIP_TEXT = {
  fresh: "the last full sync is still recent",
  backoff: "waiting after the last attempt",
  running: "a run is already in progress",
  disabled: "auto-sync is off",
  no_secret: "no sync secret is saved",
};

/** Plain-English version of a shouldRunAuto reason. */
export function skipReasonText(reason) {
  return SKIP_TEXT[reason] || String(reason || "unknown");
}

function formatAgo(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 1) return "just now";
  if (mins < 90) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
}

function clock(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** "about 14:30", "about 09:05 tomorrow", "about 09:05 on Thursday". */
export function formatDueTime(at, now = Date.now()) {
  const when = clock(at);
  const day = new Date(at).toDateString();
  if (day === new Date(now).toDateString()) return `about ${when}`;
  if (day === new Date(now + 24 * HOUR).toDateString()) return `about ${when} tomorrow`;
  return `about ${when} on ${new Date(at).toLocaleDateString([], { weekday: "long" })}`;
}

/** One line for the popup: when it last ran and how it went. */
export function describeLastRun(auto, now = Date.now()) {
  const result = auto?.lastResult;
  if (!result) return "Auto-sync has not run yet.";
  const outcome = result.ok ? (result.partial ? "incomplete" : "ok") : "failed";
  return `Last run ${formatAgo(now - result.at)} (${outcome}): ${result.text}`;
}

/**
 * The popup's status block: when the next real sync is due, why the last check
 * did not run one, and when the last full sync and the last attempt happened.
 */
export function describeAutoStatus({
  enabled = true,
  hasSecret = true,
  auto = null,
  lockAt = null,
  now = Date.now(),
} = {}) {
  const decision = shouldRunAuto({ enabled, now, auto, lockAt, hasSecret });
  const lines = [];

  if (decision.reason === "running") {
    lines.push("Running now… (uses an inactive tab; this can take a minute)");
  } else if (!hasSecret) {
    lines.push("Next sync: never — no sync secret is saved. Enter it above.");
  } else if (!enabled) {
    lines.push("Next sync: never — auto-sync is off. Run now still works.");
  } else if (decision.run) {
    lines.push("Next sync due now — the hourly check runs it within the hour.");
  } else {
    const due = nextDueAt({ enabled, now, auto, hasSecret });
    lines.push(
      `Next sync due ${formatDueTime(due, now)} (checked hourly) — skipped for now because ${skipReasonText(decision.reason)}.`,
    );
  }

  const lastOk = past(auto?.lastSuccessAt, now);
  const lastTry = past(auto?.lastAttemptAt, now);
  if (!lastOk && !lastTry) {
    lines.push("Auto-sync has not run yet.");
  } else {
    const okPart = lastOk
      ? `Last full sync ${formatAgo(now - lastOk)} (${clock(lastOk)}).`
      : "No full sync yet.";
    lines.push(`${okPart} ${describeLastRun(auto, now)}`);
  }

  const checkedAt = past(auto?.lastCheckAt, now);
  if (checkedAt && auto?.lastSkipReason) {
    lines.push(
      `Last check ${formatAgo(now - checkedAt)}: skipped (${skipReasonText(auto.lastSkipReason)}).`,
    );
  }
  return lines.join("\n");
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
