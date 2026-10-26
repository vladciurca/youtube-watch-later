import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeWatchLaterLibrary } from "../api/_lib/merge.mjs";
import {
  applyDoneOp,
  applyDoneOverrides,
  doneIds,
  emptyDone,
  normalizeDone,
} from "../api/_lib/done.mjs";
import { applyQueueOp, emptyQueue, queueIds } from "../api/_lib/queue.mjs";
import {
  loadDone,
  loadQueue,
  pruneQueueForLibrary,
  saveDone,
  saveLiveLibrary,
  saveQueue,
} from "../api/_lib/store.mjs";

const A = "aaaaaaaaaaa";
const B = "bbbbbbbbbbb";
const C = "ccccccccccc";
const T = "2026-10-26T10:00:00.000Z";

let d = emptyDone();
d = applyDoneOp(d, { type: "done", id: A }, T);
d = applyDoneOp(d, { type: "done", id: A }, T);
d = applyDoneOp(d, { type: "done", id: B }, T);
assert.deepEqual(doneIds(d), [A, B]);
assert.equal(d.items[0].doneAt, T);
assert.deepEqual(doneIds(applyDoneOp(d, { type: "done", id: "bad" }, T)), [A, B]);
assert.deepEqual(doneIds(applyDoneOp(d, { type: "undone", id: A }, T)), [B]);
assert.deepEqual(doneIds(applyDoneOp(d, { type: "undone", id: C }, T)), [A, B]);
assert.deepEqual(doneIds(normalizeDone({ items: [A, { id: A }, { id: "x" }, B] })), [A, B]);

const videos = [
  { id: A, remainingSec: 500, watchedPct: 40, status: "Partially watched" },
  { id: B, remainingSec: 0, watchedPct: 100, status: "Almost finished" },
  { id: C, remainingSec: 90, watchedPct: 80, status: "Partially watched" },
];
const eff = applyDoneOverrides(videos, d);
assert.equal(eff[0].remainingSec, 0);
assert.equal(eff[0].watchedPct, 100);
assert.equal(eff[0].markedDone, true);
assert.equal(eff[2].remainingSec, 90, "others untouched");
assert.equal(applyDoneOverrides(videos, emptyDone()), videos);

// a sync resets progress to what YouTube says; the override still wins
const synced = mergeWatchLaterLibrary(
  [{ id: A, title: "A", author: "x", durationSec: 600, watchedPct: 40, droppedAt: null, savedRank: 0 }],
  [{ id: A, title: "A", author: "x", durationSec: 600, watchedPct: 12 }],
  T,
  {},
).library.videos;
assert.equal(synced[0].watchedPct, 12);
assert.equal(applyDoneOverrides(synced, d)[0].remainingSec, 0, "Done survives a sync");
assert.ok(!("markedDone" in synced[0]), "sync never writes Done into the library");

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
await assert.rejects(() => loadDone(), /BLOB_READ_WRITE_TOKEN/);
process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_token_not_real";
const sdk = memorySdk();
assert.deepEqual(doneIds(await loadDone(sdk)), []);
await saveDone(d, sdk);
assert.deepEqual(doneIds(await loadDone(sdk)), [A, B]);
assert.ok(sdk.files.has("watch-later/done.json"));

// library sync writes only library.json
const before = sdk.files.get("watch-later/done.json");
await saveLiveLibrary({ videos: synced }, sdk);
assert.equal(sdk.files.get("watch-later/done.json"), before);

// post-sync prune takes marked-done videos off the queue; others (incl. Dropped) stay
let q = emptyQueue();
for (const id of [A, B, C]) q = applyQueueOp(q, { type: "add", id }, T);
await saveQueue(q, sdk);
const libraryVideos = [
  { id: A, remainingSec: 500, droppedAt: null },
  { id: B, remainingSec: 100, droppedAt: null },
  { id: C, remainingSec: 90, droppedAt: T },
];
const pruned = await pruneQueueForLibrary(libraryVideos, sdk);
assert.deepEqual(pruned.removed.sort(), [A, B]);
assert.deepEqual(queueIds(await loadQueue(sdk)), [C]);

// API handler guards
const { default: handler } = await import("../api/done.js");
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
  (await call("POST", { headers: { host: "a.example", origin: "https://evil.example" }, body: { op: { type: "done", id: A } } })).status,
  403,
);
assert.equal((await call("POST", { body: { op: { type: "nope", id: A } } })).status, 400);
assert.equal((await call("POST", { body: { op: { type: "done", id: "bad" } } })).status, 400);

// UI wiring
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
assert.match(read("../src/components/VideoRow.tsx"), /Mark not done/);
assert.match(read("../src/components/QueueList.tsx"), /touchstart/);
assert.match(read("../src/components/QueueList.tsx"), /passive: false/);
assert.match(read("../src/index.css"), /touch-action: none/);

console.log("done tests: mark/undo, override survives sync, sync leaves done blob alone, queue pruned, API guards, touch handle wiring ok");
