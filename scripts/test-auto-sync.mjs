import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTO_DONE_CAP,
  AUTO_MAX_FAILS,
  AUTO_MIN_INTERVAL_MS,
  AUTO_RETRY_MS,
  AUTO_STALE_LOCK_MS,
  describeAutoStatus,
  describeDoneStep,
  describeLastRun,
  describeSkippedManual,
  describeSyncFailure,
  describeSyncResult,
  hasSyncSecret,
  isAutoDoneEnabled,
  isAutoEnabled,
  nextDueAt,
  recordAttempt,
  recordCheck,
  recordRunStart,
  recoverInterruptedState,
  shouldRunAuto,
} from "../extension/auto-sync.js";

const root = dirname(fileURLToPath(import.meta.url));
const ext = (n) => readFileSync(join(root, "../extension", n), "utf8");
const H = 3600 * 1000;
const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);
const base = { enabled: true, now: NOW, hasSecret: true };

// defaults
assert.equal(isAutoEnabled(undefined), true, "auto-sync defaults on");
assert.equal(isAutoEnabled(true), true);
assert.equal(isAutoEnabled(false), false);
assert.equal(isAutoDoneEnabled(undefined), false, "unattended Done step defaults off");
assert.equal(isAutoDoneEnabled(true), true);
assert.equal(AUTO_MIN_INTERVAL_MS, 20 * H);
assert.equal(AUTO_DONE_CAP, 5);

// never ran -> due
assert.deepEqual(shouldRunAuto({ ...base, auto: null }), { run: true, reason: "due" });
// fresh success (19 h) -> not due; 20 h -> due (catch-up after Arc was closed)
assert.equal(shouldRunAuto({ ...base, auto: { lastSuccessAt: NOW - 19 * H, lastAttemptAt: NOW - 19 * H } }).reason, "fresh");
assert.equal(shouldRunAuto({ ...base, auto: { lastSuccessAt: NOW - 20 * H, lastAttemptAt: NOW - 20 * H } }).run, true);
assert.equal(shouldRunAuto({ ...base, auto: { lastSuccessAt: NOW - 3 * 24 * H, lastAttemptAt: NOW - 3 * 24 * H } }).run, true);
// disabled / no secret / running
assert.equal(shouldRunAuto({ ...base, enabled: false, auto: null }).reason, "disabled");
assert.equal(shouldRunAuto({ ...base, hasSecret: false, auto: null }).reason, "no_secret");
assert.equal(shouldRunAuto({ ...base, auto: null, lockAt: NOW - 60 * 1000 }).reason, "running");
assert.equal(shouldRunAuto({ ...base, auto: null, lockAt: NOW - AUTO_STALE_LOCK_MS - 1 }).run, true, "stale lock ignored");
// force (Run now) ignores freshness and disabled, but not running or missing secret
assert.equal(shouldRunAuto({ ...base, enabled: false, force: true, auto: { lastSuccessAt: NOW - H } }).run, true);
assert.equal(shouldRunAuto({ ...base, force: true, auto: null, lockAt: NOW - 1000 }).run, false);
assert.equal(shouldRunAuto({ ...base, force: true, hasSecret: false, auto: null }).reason, "no_secret");
// failures back off: 2 h, then a full 20 h after 3 in a row. Never a tight loop.
const failed = (mins, streak) => ({ lastAttemptAt: NOW - mins * 60000, failedStreak: streak, lastSuccessAt: NOW - 30 * H });
assert.equal(shouldRunAuto({ ...base, auto: failed(30, 1) }).reason, "backoff");
assert.equal(shouldRunAuto({ ...base, auto: failed(AUTO_RETRY_MS / 60000 + 1, 1) }).run, true);
assert.equal(shouldRunAuto({ ...base, auto: failed(5 * 60, AUTO_MAX_FAILS) }).reason, "backoff");
assert.equal(shouldRunAuto({ ...base, auto: failed(21 * 60, AUTO_MAX_FAILS) }).run, true);
// future timestamps (clock moved) are ignored instead of blocking forever
assert.equal(shouldRunAuto({ ...base, auto: { lastSuccessAt: NOW + 30 * H, lastAttemptAt: NOW + 30 * H } }).run, true);

// state folding
let st = recordAttempt(null, { ok: false, text: "boom", now: NOW, trigger: "daily" });
assert.equal(st.failedStreak, 1);
assert.equal(st.lastSuccessAt, null);
st = recordAttempt(st, { ok: false, text: "boom", now: NOW + H, trigger: "startup" });
assert.equal(st.failedStreak, 2);
st = recordAttempt(st, { ok: true, text: "fine", now: NOW + 2 * H, trigger: "manual" });
assert.equal(st.failedStreak, 0);
assert.equal(st.lastSuccessAt, NOW + 2 * H);
assert.deepEqual(st.lastResult, {
  ok: true,
  partial: false,
  text: "fine",
  at: NOW + 2 * H,
  trigger: "manual",
});
const failAfterOk = recordAttempt(st, { ok: false, text: "x", now: NOW + 3 * H });
assert.equal(failAfterOk.lastSuccessAt, NOW + 2 * H, "a failure keeps the last success time");

// A partial scrape uploaded fine but did not read the whole playlist, so it is
// not a completed sync: it must not push the next run 20 h out.
const partial1 = recordAttempt(null, {
  ok: true,
  partial: true,
  text: "Sync: scraped 40, looked incomplete so nothing was dropped",
  now: NOW,
  trigger: "daily",
});
assert.equal(partial1.lastSuccessAt, null, "a partial scrape is not a full success");
assert.equal(partial1.partialStreak, 1);
assert.equal(partial1.failedStreak, 0, "a partial scrape is not a failure either");
assert.equal(shouldRunAuto({ ...base, now: NOW + H, auto: partial1 }).reason, "backoff");
assert.equal(
  shouldRunAuto({ ...base, now: NOW + AUTO_RETRY_MS + 60000, auto: partial1 }).run,
  true,
  "a partial scrape is retried after the 2 h backoff, not 20 h later",
);
// …but repeated partials must not retry every 2 h forever.
let partialN = partial1;
for (let i = 1; i < AUTO_MAX_FAILS; i += 1) {
  partialN = recordAttempt(partialN, { ok: true, partial: true, text: "again", now: NOW + i * 3 * H });
}
const lastPartialAt = NOW + (AUTO_MAX_FAILS - 1) * 3 * H;
assert.equal(partialN.partialStreak, AUTO_MAX_FAILS);
assert.equal(shouldRunAuto({ ...base, now: lastPartialAt + 3 * H, auto: partialN }).reason, "backoff");
assert.equal(shouldRunAuto({ ...base, now: lastPartialAt + 21 * H, auto: partialN }).run, true);
// A complete scrape clears the partial streak and defers the next run a full interval.
const complete = recordAttempt(partialN, { ok: true, text: "fine", now: lastPartialAt + 21 * H });
assert.equal(complete.partialStreak, 0);
assert.equal(complete.lastSuccessAt, lastPartialAt + 21 * H);
assert.equal(shouldRunAuto({ ...base, now: lastPartialAt + 40 * H, auto: complete }).reason, "fresh");

// Skipped cheap checks are recorded so "never ran" can be told from "ran and skipped".
const checked = recordCheck(st, { now: NOW + 3 * H, reason: "fresh" });
assert.equal(checked.lastCheckAt, NOW + 3 * H);
assert.equal(checked.lastSkipReason, "fresh");
assert.equal(checked.lastSuccessAt, st.lastSuccessAt, "recording a check keeps the rest of the state");
assert.deepEqual(checked.lastResult, st.lastResult);
const ranAfterCheck = recordAttempt(checked, { ok: true, text: "fine", now: NOW + 25 * H });
assert.equal(ranAfterCheck.lastSkipReason, null, "a real run clears the last skip reason");
assert.equal(ranAfterCheck.lastCheckAt, NOW + 25 * H);

// When the next run is due, by the same rules as shouldRunAuto.
assert.equal(nextDueAt({ ...base, auto: null }), NOW, "never ran -> due now");
assert.equal(nextDueAt({ ...base, hasSecret: false, auto: null }), null);
assert.equal(nextDueAt({ ...base, enabled: false, auto: null }), null);
assert.equal(
  nextDueAt({ ...base, auto: { lastSuccessAt: NOW - 5 * H, lastAttemptAt: NOW - 5 * H } }),
  NOW - 5 * H + AUTO_MIN_INTERVAL_MS,
);
assert.equal(
  nextDueAt({ ...base, auto: { lastAttemptAt: NOW - 30 * 60000, failedStreak: 1 } }),
  NOW - 30 * 60000 + AUTO_RETRY_MS,
);
// nextDueAt and shouldRunAuto never disagree.
for (const auto of [
  null,
  { lastSuccessAt: NOW - 19 * H, lastAttemptAt: NOW - 19 * H },
  { lastSuccessAt: NOW - 25 * H, lastAttemptAt: NOW - 30 * 60000, failedStreak: 1 },
  { lastSuccessAt: NOW - 25 * H, lastAttemptAt: NOW - 5 * H, failedStreak: AUTO_MAX_FAILS },
  partial1,
]) {
  for (const offset of [-H, -60000, 0, 60000, H, 25 * H]) {
    const now = nextDueAt({ ...base, auto }) + offset;
    const due = nextDueAt({ enabled: true, hasSecret: true, now, auto });
    assert.equal(
      shouldRunAuto({ enabled: true, hasSecret: true, now, auto }).run,
      due <= now,
      `nextDueAt disagrees with shouldRunAuto at offset ${offset}`,
    );
  }
}

// The popup line says when the next sync is due and why a run was skipped.
const freshState = { lastSuccessAt: NOW - 6 * H, lastAttemptAt: NOW - 6 * H, lastResult: { ok: true, text: "fine", at: NOW - 6 * H } };
const freshText = describeAutoStatus({ enabled: true, hasSecret: true, auto: freshState, now: NOW });
const dueClock = new Date(NOW + 14 * H).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
assert.match(freshText, /Next sync due/);
assert.ok(freshText.includes(dueClock), `expected the due clock time ${dueClock} in:\n${freshText}`);
assert.match(freshText, /still recent/, "says why it is being skipped");
assert.match(freshText, /Last full sync 6 h ago/, "says when the last successful sync was");

const dueText = describeAutoStatus({ enabled: true, hasSecret: true, auto: null, now: NOW });
assert.match(dueText, /due now/i);
assert.match(dueText, /within the hour/);
assert.match(dueText, /has not run yet/);

const noSecretText = describeAutoStatus({ enabled: true, hasSecret: false, auto: null, now: NOW });
assert.match(noSecretText, /no sync secret/i);
assert.ok(!/Next sync due about/.test(noSecretText), "nothing is scheduled without a secret");

const offText = describeAutoStatus({ enabled: false, hasSecret: true, auto: freshState, now: NOW });
assert.match(offText, /auto-sync is off/i);

const runningText = describeAutoStatus({ enabled: true, hasSecret: true, auto: freshState, lockAt: NOW - 60000, now: NOW });
assert.match(runningText, /Running now/);

// "Ran and was skipped" is distinguishable from "never ran".
const skippedState = recordCheck(
  { lastAttemptAt: NOW - 3 * H, failedStreak: 1, lastResult: { ok: false, text: "Timed out", at: NOW - 3 * H } },
  { now: NOW - 5 * 60000, reason: "backoff" },
);
const skippedText = describeAutoStatus({ enabled: true, hasSecret: true, auto: skippedState, now: NOW });
assert.match(skippedText, /No full sync yet/);
assert.match(skippedText, /Last run 3 h ago \(failed\): Timed out/);
assert.match(skippedText, /Last check 5 min ago: skipped \(waiting after the last attempt\)/);

// popup text
assert.equal(describeLastRun(null), "Auto-sync has not run yet.");
assert.match(describeLastRun(st, NOW + 2 * H + 5 * 60000), /Last run 5 min ago \(ok\): fine/);
assert.match(describeLastRun(failAfterOk, NOW + 30 * H), /\(failed\)/);
assert.equal(describeSyncResult({ scraped: 700, dropped: 3 }), "scraped 700, 3 marked Dropped");
assert.match(describeSyncResult({ scraped: 40, partial: true }), /incomplete scrape \(40 videos\)/);
assert.match(describeSyncResult({ scraped: 40, partial: true }), /does not count as a full sync/);

// Every way a run can miss an accepted POST has its own sentence.
assert.equal(hasSyncSecret(undefined), false);
assert.equal(hasSyncSecret("   "), false);
assert.equal(hasSyncSecret("secret"), true);
const unauthorized = new Error("Unauthorized");
unauthorized.status = 401;
assert.match(describeSyncFailure(unauthorized), /rejected the sync secret \(401\)/);
assert.match(describeSyncFailure(unauthorized), /Nothing was uploaded/);
assert.equal(
  describeSyncFailure(new Error(describeSyncFailure(unauthorized))),
  describeSyncFailure(unauthorized),
  "formatting a failure twice must not nest the sentence",
);
const forbidden = new Error("nope");
forbidden.status = 403;
assert.match(describeSyncFailure(forbidden), /rejected the sync secret \(403\)/);
assert.match(describeSyncFailure(new TypeError("Failed to fetch")), /Network error talking to the library/);
assert.match(
  describeSyncFailure(new Error("No Watch Later videos were scraped.")),
  /Scrape returned zero videos/,
);
assert.match(
  describeSyncFailure(new Error("Watch Later load timed out")),
  /Timed out waiting for the Watch Later tab/,
);
assert.match(
  describeSyncFailure(new Error("Could not establish connection. Receiving end does not exist.")),
  /Run never started/,
);
assert.match(describeSkippedManual("no_secret"), /No sync secret is saved, so Run now did not start/);
assert.match(describeSkippedManual("running"), /did not start: another sync is already marked in progress/);

const started = recordRunStart(
  { lastSuccessAt: NOW - 30 * H },
  { now: NOW, trigger: "manual" },
);
assert.equal(started.lastResult.pending, true);
assert.equal(started.failedStreak ?? 0, 0, "a start is not a failed attempt");
assert.equal(started.lastSuccessAt, NOW - 30 * H);
assert.match(describeLastRun(started, NOW), /has not reported a result yet/);
const orphan = recoverInterruptedState(started, NOW - 1000, NOW + 5000);
assert.match(orphan.lastResult.text, /Run never finished/);
assert.equal(orphan.lastResult.pending, undefined);
assert.equal(orphan.failedStreak, 1);
assert.equal(orphan.lastSuccessAt, NOW - 30 * H, "a killed run keeps the last full sync");
assert.equal(recoverInterruptedState({ lastResult: { ok: true, text: "fine" } }, null, NOW), null);
const failedVisible = describeAutoStatus({
  enabled: true,
  hasSecret: true,
  now: NOW,
  auto: recordAttempt(null, {
    ok: false,
    text: describeSyncFailure(unauthorized),
    now: NOW - 60000,
    trigger: "manual",
  }),
});
assert.match(failedVisible, /rejected the sync secret \(401\)/);
assert.match(failedVisible, /\(failed\)/);
assert.equal(describeDoneStep({ ok: ["a", "b"], skipped: [1], failed: [] }), "Done step: 2 marked watched, 1 skipped");
assert.equal(describeDoneStep(null), "Done step did not run");

// wiring in the extension
const manifest = JSON.parse(ext("manifest.json"));
assert.equal(manifest.version, "1.5.2");
assert.deepEqual(manifest.permissions, ["storage", "tabs", "scripting", "alarms"]);
const bg = ext("background.js");
assert.match(bg, /chrome\.alarms\.create\(AUTO_ALARM, \{ delayInMinutes: 5, periodInMinutes: 60 \}\)/);
assert.match(bg, /onStartup/, "catch-up on browser startup");
assert.match(bg, /performWatchLaterSync\(\{ background: true \}\)/, "unattended scrape uses an inactive tab");
assert.match(bg, /active: !background/);
assert.equal((bg.match(/runAuto\(/g) || []).length >= 4, true);
// A run reports whether the scrape was complete, so a partial one is retried sooner.
assert.match(bg, /partial = result\.partial === true/);
assert.match(bg, /recordAttempt\(latest\[AUTO_STATE_KEY\], \{ ok, partial,/);
// Every skipped check is recorded, including the unattended ones.
assert.match(bg, /recordCheck\(stored\[AUTO_STATE_KEY\], \{ now, reason: decision\.reason \}\)/);
assert.match(bg, /describeSyncFailure/);
assert.match(bg, /describeSkippedManual\(decision\.reason\)/);
assert.match(bg, /recordRunStart/);
assert.match(bg, /recoverInterruptedState/);
assert.match(bg, /hasSyncSecret\(stored\.syncSecret\)/);
assert.match(bg, /await booted/);
assert.match(bg, /runAuto\("manual", \{ force: true \}\)/);
assert.match(bg, /AUTO_RUN_NOW"\) return undefined;[\s\S]*return true;/);
assert.match(ext("popup.js"), /describeSyncFailure/);
assert.match(ext("popup.js"), /Run never started/);
assert.match(ext("popup.js"), /syncSecret\.value\.trim\(\)/);
// Waiting for a tab must not miss a load that already finished, and a reused
// Watch Later tab is reloaded so the scrape never reads a stale ytInitialData.
assert.equal(/function waitForComplete\(/.test(bg), false, "one tab-wait helper, not two");
assert.match(bg, /chrome\.tabs\.reload\(existing\.id\)/, "a reused Watch Later tab is reloaded");
assert.match(bg, /fresh: true/, "after a reload, wait for the next completion");
assert.match(bg, /tab\.discarded !== true/, "a sleeping tab never fires 'complete'");
assert.match(ext("popup.html"), /Auto-sync daily/);
assert.match(ext("popup.html"), /id="autoRun"/);
const popup = ext("popup.js");
assert.match(popup, /AUTO_RUN_NOW/);
assert.match(popup, /describeAutoStatus/, "the popup shows the scheduling status, not just the last run");
assert.match(popup, /hasSecret/);

console.log("auto-sync tests: 20 h catch-up, fresh/disabled/no-secret/running, force, 2 h + 20 h failure backoff, partial-not-success + partial streak cap, skip-reason records, nextDueAt agrees with shouldRunAuto, clock skew, state folding, popup status text, alarm/startup/tab-reload wiring ok");
