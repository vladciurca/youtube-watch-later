import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
  DONE_THRESHOLD_PCT,
  finishJob,
  initialJob,
  reasonLabel,
  recordResult,
  seekTarget,
  selectDoneToSync,
  summarizeJob,
} from "../extension/done-sync.js";
import { DONE_THRESHOLD_PCT as APP_THRESHOLD } from "../api/_lib/threshold.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const ext = (name) => readFileSync(join(root, "../extension", name), "utf8");
const A = "aaaaaaaaaaa";
const B = "bbbbbbbbbbb";
const C = "ccccccccccc";
const D = "ddddddddddd";
const E = "eeeeeeeeeee";
const F = "fffffffffff";

// ---- same threshold as the app
assert.equal(DONE_THRESHOLD_PCT, APP_THRESHOLD);

// ---- selection rules
const videos = [
  { id: A, title: "A", watchedPct: 10 },
  { id: B, title: "B", watchedPct: 94 },
  { id: C, title: "C", watchedPct: 95 }, // already watched on YouTube
  { id: D, title: "D", watchedPct: 100 }, // already watched on YouTube
  { id: E, title: "E", watchedPct: 20, droppedAt: "2026-10-01T00:00:00.000Z" }, // dropped still syncs
  { id: F, title: "F", watchedPct: null }, // unknown progress still syncs
];
const sel = selectDoneToSync({
  doneItems: [
    { id: A }, { id: B }, { id: C }, { id: D }, { id: E }, { id: F },
    { id: "zzzzzzzzzzz" }, // not in library
    { id: "bad" }, // invalid
    { id: A }, // duplicate
  ],
  videos,
});
assert.deepEqual(sel.toSync.map((v) => v.id), [A, B, E, F], "order follows the Done list");
assert.deepEqual(sel.counts, {
  alreadyWatched: 2,
  alreadySynced: 0,
  previouslySkipped: 0,
  notInLibrary: 1,
  invalid: 1,
});
const sel2 = selectDoneToSync({
  doneItems: [{ id: A }, { id: B }, { id: E }],
  videos,
  synced: { [A]: 1 },
  skipped: { [E]: "live" },
});
assert.deepEqual(sel2.toSync.map((v) => v.id), [B]);
assert.equal(sel2.counts.alreadySynced, 1);
assert.equal(sel2.counts.previouslySkipped, 1);
assert.deepEqual(selectDoneToSync({ doneItems: [], videos }).toSync, []);
assert.deepEqual(selectDoneToSync({ doneItems: null, videos: null }).toSync, []);

// ---- seek target
assert.equal(seekTarget(100), 96);
assert.equal(seekTarget(3), 0);
assert.equal(seekTarget(0), 0);
assert.equal(seekTarget(Infinity), 0);
assert.equal(seekTarget(NaN), 0);
assert.equal(seekTarget(100, 10), 90);

// ---- job bookkeeping
let job = initialJob([{ id: A }, { id: B }, { id: C }, { id: D }], 1000);
assert.equal(job.state, "running");
job = recordResult(job, { id: A }, { status: "ok" });
job = recordResult(job, { id: B }, { status: "live" });
job = recordResult(job, { id: C }, { status: "timeout", detail: "x" });
assert.deepEqual(job.ok, [A]);
assert.deepEqual(job.skipped, [{ id: B, reason: "live" }]);
assert.equal(job.failed[0].reason, "timeout");
assert.equal(job.index, 3);
assert.match(summarizeJob(job), /Video 4 of 4 · 1 synced, 1 skipped, 1 failed/);
const cancelled = finishJob({ ...job, cancelRequested: true }, 2000);
assert.equal(cancelled.state, "cancelled");
assert.match(summarizeJob(cancelled), /Cancelled after 3 of 4/);
job = recordResult(job, { id: D }, { status: "ok" });
assert.equal(finishJob(job).state, "finished");
assert.equal(finishJob({ ...job, cancelRequested: true }).state, "finished", "cancel after the last video = finished");
assert.equal(reasonLabel("age_restricted"), "age-restricted");

// ---- manifest + safety wiring
const manifest = JSON.parse(ext("manifest.json"));
assert.equal(manifest.version, "1.5.1");
assert.deepEqual(manifest.permissions, ["storage", "tabs", "scripting", "alarms"], "only alarms is new");
assert.ok(manifest.host_permissions.includes("https://www.youtube.com/*"));
const bg = ext("background.js");
assert.match(bg, /message\.confirmed !== true/, "start needs explicit confirmation");
assert.match(bg, /isAutoDoneEnabled\(stored\[AUTO_DONE_KEY\]\)/, "unattended Done step only runs when the user opted in");
assert.match(bg, /runDoneSync\(\{ maxVideos: AUTO_DONE_CAP \}\)/, "unattended Done step is capped");
assert.equal((bg.match(/runDoneSync\(\)/g) || []).length, 1, "the uncapped Done run only starts from the confirmed handler");
assert.match(bg, /focused: false/, "videos open in an unfocused popup window");
assert.match(bg, /muted: true/);
assert.match(ext("popup.js"), /DONE_SYNC_PREVIEW/);
assert.match(ext("popup.html"), /Sync Done to YouTube/);
const runner = ext("mark-watched.js");
assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|youtubei/.test(runner), "no network calls or YouTube internals in the page runner");
assert.match(runner, /currentTime = seekTarget/);

// ---- page runner against a fake player
function makePage({ url, duration = 30, errorText = "", ad = 0, stall = false, navigateAfter = null, live = false }) {
  const log = { currentTimeSets: [], muted: false };
  let t = 0;
  let playing = false;
  let ended = false;
  const video = {
    readyState: 4,
    duration: live ? Infinity : duration,
    get currentTime() { return t; },
    set currentTime(v) { log.currentTimeSets.push(v); t = v; },
    set muted(v) { log.muted = v; },
    get muted() { return log.muted; },
    volume: 1,
    get paused() { return !playing; },
    get ended() { return ended; },
    async play() { playing = true; },
  };
  const state = { url, adLeft: ad, skipClicks: 0 };
  setInterval(() => {
    if (playing && !stall && !ended) {
      t += 1; // fast-forward fake time: 1s of media per 20ms
      if (t >= video.duration) { t = video.duration; ended = true; playing = false; }
    }
    if (navigateAfter && t >= navigateAfter) state.url = "https://www.youtube.com/watch?v=zzzzzzzzzzz";
  }, 20).unref();
  const skipButton = { offsetParent: {}, click() { state.skipClicks += 1; state.adLeft = 0; } };
  const document = {
    querySelector(sel) {
      if (/ytd-player-error|#error-screen|\.ytp-error/.test(sel)) {
        return errorText ? { textContent: errorText } : null;
      }
      if (sel.includes("video") && !sel.includes("ad-showing") && !sel.includes("ytp-live")) return video;
      if (sel.includes("ad-showing")) return state.adLeft > 0 ? {} : null;
      if (sel.includes("ytp-skip-ad")) return state.adLeft > 0 ? skipButton : null;
      if (sel.includes("ytp-live")) return null;
      return null;
    },
    querySelectorAll(sel) {
      const node = document.querySelector(sel);
      return node ? [node] : [];
    },
  };
  const ctx = vm.createContext({
    window: {},
    document,
    HTMLElement: Object,
    URL,
    setTimeout,
    Date,
    Number,
    Promise,
    location: { get href() { return state.url; } },
  });
  ctx.window = ctx;
  vm.runInContext(runner, ctx);
  return { ctx, log, state };
}

const fast = { beforeEndSec: 4, playTimeoutMs: 4000, settleMs: 100, metaTimeoutMs: 600, adTimeoutMs: 300 };
const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

{
  const page = makePage({ url: watchUrl(A), duration: 30 });
  const result = await page.ctx.__wlMarkWatched({ ...fast, videoId: A });
  assert.equal(result.status, "ok", JSON.stringify(result));
  assert.deepEqual(page.log.currentTimeSets, [26], "seeks to duration - 4s with video.currentTime");
  assert.equal(page.log.muted, true, "player is muted");
}
{
  const page = makePage({ url: watchUrl(A), live: true });
  assert.equal((await page.ctx.__wlMarkWatched({ ...fast, videoId: A })).status, "live");
  assert.deepEqual(page.log.currentTimeSets, [], "never seeks a live stream");
}
{
  const page = makePage({ url: watchUrl(A), errorText: "Video unavailable. This video has been removed by the uploader" });
  assert.equal((await page.ctx.__wlMarkWatched({ ...fast, videoId: A })).status, "unavailable");
}
{
  const page = makePage({ url: watchUrl(A), errorText: "Sign in to confirm your age. This video may be inappropriate for some users." });
  assert.equal((await page.ctx.__wlMarkWatched({ ...fast, videoId: A })).status, "age_restricted");
}
{
  const page = makePage({ url: watchUrl(A), errorText: "This video is private" });
  assert.equal((await page.ctx.__wlMarkWatched({ ...fast, videoId: A })).status, "private");
}
{
  const page = makePage({ url: watchUrl(A), ad: 1 });
  const result = await page.ctx.__wlMarkWatched({ ...fast, adTimeoutMs: 2000, videoId: A });
  assert.equal(result.status, "ok", "ad skipped, then seeks");
  assert.equal(page.state.skipClicks >= 1, true);
}
{
  const page = makePage({ url: watchUrl(A), ad: 1 });
  page.ctx.document.querySelector = ((orig) => (sel) => (sel.includes("ytp-skip-ad") ? null : orig(sel)))(page.ctx.document.querySelector);
  const result = await page.ctx.__wlMarkWatched({ ...fast, adTimeoutMs: 400, videoId: A });
  assert.equal(result.status, "ad_timeout", "unskippable ad times out instead of hanging");
}
{
  const page = makePage({ url: watchUrl(A), stall: true });
  const result = await page.ctx.__wlMarkWatched({ ...fast, playTimeoutMs: 500, videoId: A });
  assert.ok(["timeout", "stalled"].includes(result.status), result.status);
}
{
  const page = makePage({ url: watchUrl(A), duration: 30, navigateAfter: 28 });
  const result = await page.ctx.__wlMarkWatched({ ...fast, videoId: A });
  assert.equal(result.status, "navigated", "autoplay-next away from the video is reported, not synced");
}
{
  const { ctx } = makePage({ url: watchUrl(A) });
  const h = ctx.__wlMarkWatchedHelpers;
  assert.equal(h.seekTarget(100, 4), 96);
  assert.equal(h.classifyErrorText(""), null);
  assert.equal(h.classifyErrorText("Playback on other websites has been disabled"), null);
}

console.log("done-sync tests: selection (94/95/100, dropped, synced, skipped), seek target, job bookkeeping, no new permissions, manual-only wiring, page runner (ok/live/unavailable/age/private/ad/stall/navigated) ok");
