import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeWatchLaterLibrary } from "../api/_lib/merge.mjs";
import {
  applyDoneOp,
  applyDoneOverrides,
  emptyDone,
} from "../api/_lib/done.mjs";
import {
  MAX_DOWNLOADED,
  applyDownloadedMarks,
  applyDownloadedOp,
  downloadedIds,
  emptyDownloaded,
  normalizeDownloaded,
  pruneDoneFromDownloaded,
} from "../api/_lib/downloaded.mjs";
import {
  loadDownloaded,
  pruneDownloadedForLibrary,
  saveDownloaded,
  saveDone,
  saveLiveLibrary,
} from "../api/_lib/store.mjs";

const A = "aaaaaaaaaaa";
const B = "bbbbbbbbbbb";
const C = "ccccccccccc";
const T = "2026-11-24T20:00:00.000Z";

let list = emptyDownloaded();
list = applyDownloadedOp(list, { type: "downloaded", id: A }, T);
list = applyDownloadedOp(list, { type: "downloaded", id: A }, T);
list = applyDownloadedOp(list, { type: "downloaded", id: B }, T);
assert.deepEqual(downloadedIds(list), [A, B], "toggle on is idempotent");
assert.equal(list.items[0].downloadedAt, T);
assert.deepEqual(downloadedIds(applyDownloadedOp(list, { type: "downloaded", id: "bad" }, T)), [A, B]);
assert.deepEqual(downloadedIds(applyDownloadedOp(list, { type: "undownloaded", id: A }, T)), [B]);
assert.deepEqual(downloadedIds(applyDownloadedOp(list, { type: "undownloaded", id: C }, T)), [A, B]);
assert.deepEqual(
  downloadedIds(normalizeDownloaded({ items: [A, { id: A }, { id: "x" }, B] })),
  [A, B],
);

const videos = [
  { id: A, remainingSec: 500, watchedPct: 40, status: "Partially watched" },
  { id: B, remainingSec: 0, watchedPct: 100, status: "Done" },
  { id: C, remainingSec: 90, watchedPct: 80, status: "Partially watched" },
];
const marked = applyDownloadedMarks(videos, list);
assert.equal(marked[0].downloaded, true);
assert.equal(marked[0].downloadedAt, T);
assert.equal(marked[1].downloaded, undefined, "Done (100%) does not keep the mark");
assert.equal(marked[2].downloaded, undefined, "others untouched");
assert.equal(applyDownloadedMarks(videos, emptyDownloaded()), videos);

// 95% auto-Done also clears the mark; 94% keeps it
const around = [
  { id: A, watchedPct: 94 },
  { id: B, watchedPct: 95 },
  { id: C, watchedPct: 96 },
];
const aroundList = normalizeDownloaded({ items: [A, B, C] });
const aroundMarked = applyDownloadedMarks(around, aroundList);
assert.equal(aroundMarked[0].downloaded, true, "94% can stay downloaded");
assert.ok(!aroundMarked[1].downloaded, "95% is Done, mark cleared");
assert.ok(!aroundMarked[2].downloaded, "96% is Done, mark cleared");
const pruned = pruneDoneFromDownloaded(aroundList, around, T);
assert.deepEqual(pruned.removed.sort(), [B, C]);
assert.deepEqual(downloadedIds(pruned.list), [A]);

// explicit Done below 95% also clears
const manualDone = applyDoneOverrides(
  [{ id: A, watchedPct: 40, status: "Barely started" }],
  applyDoneOp(emptyDone(), { type: "done", id: A }, T),
);
const afterManual = pruneDoneFromDownloaded({ items: [{ id: A }] }, manualDone, T);
assert.deepEqual(afterManual.removed, [A]);
assert.ok(!applyDownloadedMarks(manualDone, { items: [{ id: A }] })[0].downloaded);

// a sync resets progress; the Downloaded blob is not inside the library
const synced = mergeWatchLaterLibrary(
  [{ id: A, title: "A", author: "x", durationSec: 600, watchedPct: 40, droppedAt: null, savedRank: 0 }],
  [{ id: A, title: "A", author: "x", durationSec: 600, watchedPct: 12 }],
  T,
  {},
).library.videos;
assert.equal(synced[0].watchedPct, 12);
assert.equal(applyDownloadedMarks(synced, list)[0].downloaded, true, "Downloaded survives a sync of progress");
assert.ok(!("downloaded" in synced[0]), "sync never writes Downloaded into the library");

function memorySdk() {
  const files = new Map();
  return {
    files,
    async get(path) {
      if (!files.has(path)) return null;
      return { statusCode: 200, stream: new Blob([files.get(path)]).stream() };
    },
    async put(path, body) {
      files.set(path, body);
      return { pathname: path };
    },
  };
}

delete process.env.BLOB_READ_WRITE_TOKEN;
await assert.rejects(() => loadDownloaded(), /BLOB_READ_WRITE_TOKEN/);
process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_token_not_real";
const sdk = memorySdk();
assert.deepEqual(downloadedIds(await loadDownloaded(sdk)), []);
await saveDownloaded(list, sdk);
assert.deepEqual(downloadedIds(await loadDownloaded(sdk)), [A, B]);
assert.ok(sdk.files.has("watch-later/downloaded.json"));

const before = sdk.files.get("watch-later/downloaded.json");
await saveLiveLibrary({ videos: synced }, sdk);
assert.equal(sdk.files.get("watch-later/downloaded.json"), before, "sync leaves downloaded blob alone");

const libraryVideos = [
  { id: A, watchedPct: 40, remainingSec: 500, droppedAt: null },
  { id: B, watchedPct: 95, remainingSec: 10, droppedAt: null },
  { id: C, watchedPct: 20, remainingSec: 90, droppedAt: T },
];
let stored = emptyDownloaded();
for (const id of [A, B, C]) stored = applyDownloadedOp(stored, { type: "downloaded", id }, T);
await saveDownloaded(stored, sdk);
const autoPrune = await pruneDownloadedForLibrary(libraryVideos, sdk);
assert.deepEqual(autoPrune.removed, [B], "95% auto-Done is cleared");
assert.deepEqual(downloadedIds(await loadDownloaded(sdk)).sort(), [A, C]);

// explicit Done also pruned by pruneDownloadedForLibrary
await saveDone(applyDoneOp(emptyDone(), { type: "done", id: A }, T), sdk);
const manualPrune = await pruneDownloadedForLibrary(libraryVideos, sdk);
assert.deepEqual(manualPrune.removed.sort(), [A]);
assert.deepEqual(downloadedIds(await loadDownloaded(sdk)), [C]);

assert.ok(MAX_DOWNLOADED >= 5000);

// API handler guards
const { default: handler } = await import("../api/downloaded.js");
function call(method, { headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const listeners = {};
    const req = {
      method,
      headers,
      on(event, fn) {
        listeners[event] = fn;
        if (event === "end") {
          queueMicrotask(() => {
            if (body !== undefined) listeners.data?.(Buffer.from(JSON.stringify(body)));
            listeners.end();
          });
        }
        return req;
      },
      destroy() {},
    };
    const res = {
      statusCode: 200,
      setHeader() {},
      end(payload) {
        resolve({ status: this.statusCode, body: payload ? JSON.parse(payload) : null });
      },
    };
    handler(req, res);
  });
}
delete process.env.BLOB_READ_WRITE_TOKEN;
assert.equal((await call("GET")).status, 503);
assert.equal((await call("PUT")).status, 405);
assert.equal(
  (
    await call("POST", {
      headers: { host: "a.example", origin: "https://evil.example" },
      body: { op: { type: "downloaded", id: A } },
    })
  ).status,
  403,
);
assert.equal((await call("POST", { body: { op: { type: "nope", id: A } } })).status, 400);
assert.equal((await call("POST", { body: { op: { type: "downloaded", id: "bad" } } })).status, 400);

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
assert.match(read("../src/components/VideoRow.tsx"), /Mark downloaded/);
assert.match(read("../src/components/VideoRow.tsx"), /Downloaded/);
assert.match(read("../src/components/Header.tsx"), /downloadedCount/);
assert.match(read("../public/sw.js"), /wl-offline-v2/);
assert.match(read("../public/sw.js"), /\/api\/downloaded/);
assert.match(read("../api/done.js"), /undownloaded/);
assert.match(read("../api/sync.js"), /pruneDownloadedForLibrary/);

console.log(
  "downloaded tests: toggle, idempotent, 95% and manual Done auto-clear, sync leaves blob alone, API guards ok",
);
