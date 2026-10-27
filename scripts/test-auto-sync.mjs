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
  describeDoneStep,
  describeLastRun,
  describeSyncResult,
  isAutoDoneEnabled,
  isAutoEnabled,
  recordAttempt,
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
assert.deepEqual(st.lastResult, { ok: true, text: "fine", at: NOW + 2 * H, trigger: "manual" });
const failAfterOk = recordAttempt(st, { ok: false, text: "x", now: NOW + 3 * H });
assert.equal(failAfterOk.lastSuccessAt, NOW + 2 * H, "a failure keeps the last success time");

// popup text
assert.equal(describeLastRun(null), "Auto-sync has not run yet.");
assert.match(describeLastRun(st, NOW + 2 * H + 5 * 60000), /Last run 5 min ago \(ok\): fine/);
assert.match(describeLastRun(failAfterOk, NOW + 30 * H), /\(failed\)/);
assert.equal(describeSyncResult({ scraped: 700, dropped: 3 }), "scraped 700, 3 marked Dropped");
assert.match(describeSyncResult({ scraped: 40, partial: true }), /looked incomplete/);
assert.equal(describeDoneStep({ ok: ["a", "b"], skipped: [1], failed: [] }), "Done step: 2 marked watched, 1 skipped");
assert.equal(describeDoneStep(null), "Done step did not run");

// wiring in the extension
const manifest = JSON.parse(ext("manifest.json"));
assert.equal(manifest.version, "1.5.0");
assert.deepEqual(manifest.permissions, ["storage", "tabs", "scripting", "alarms"]);
const bg = ext("background.js");
assert.match(bg, /chrome\.alarms\.create\(AUTO_ALARM, \{ delayInMinutes: 5, periodInMinutes: 60 \}\)/);
assert.match(bg, /onStartup/, "catch-up on browser startup");
assert.match(bg, /performWatchLaterSync\(\{ background: true \}\)/, "unattended scrape uses an inactive tab");
assert.match(bg, /active: !background/);
assert.equal((bg.match(/runAuto\(/g) || []).length >= 4, true);
assert.match(ext("popup.html"), /Auto-sync daily/);
assert.match(ext("popup.html"), /id="autoRun"/);
assert.match(ext("popup.js"), /AUTO_RUN_NOW/);

console.log("auto-sync tests: 20 h catch-up, fresh/disabled/no-secret/running, force, 2 h + 20 h failure backoff, clock skew, state folding, popup text, alarm/startup wiring ok");
