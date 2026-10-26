import assert from "node:assert/strict";
import { mergeWatchLaterLibrary } from "../api/_lib/merge.mjs";
import {
  MAX_QUEUE,
  applyQueueOp,
  emptyQueue,
  isVideoId,
  normalizeQueue,
  pruneDoneFromQueue,
  queueIds,
} from "../api/_lib/queue.mjs";
import {
  loadQueue,
  pruneQueueForLibrary,
  saveLiveLibrary,
  saveQueue,
} from "../api/_lib/store.mjs";

const A = "aaaaaaaaaaa";
const B = "bbbbbbbbbbb";
const C = "ccccccccccc";
const D = "ddddddddddd";
const T = "2026-10-26T10:00:00.000Z";

// ---- pure ops
assert.ok(isVideoId(A));
assert.ok(!isVideoId("short"));
assert.ok(!isVideoId(42));

let q = emptyQueue();
q = applyQueueOp(q, { type: "add", id: A }, T);
q = applyQueueOp(q, { type: "add", id: B }, T);
q = applyQueueOp(q, { type: "add", id: C }, T);
assert.deepEqual(queueIds(q), [A, B, C]);
assert.equal(q.items[0].queuedAt, T);
assert.deepEqual(queueIds(applyQueueOp(q, { type: "add", id: A }, T)), [A, B, C], "no duplicates");
assert.deepEqual(queueIds(applyQueueOp(q, { type: "add", id: "bad" }, T)), [A, B, C]);
assert.deepEqual(queueIds(applyQueueOp(q, { type: "top", id: C }, T)), [C, A, B]);
assert.deepEqual(queueIds(applyQueueOp(q, { type: "top", id: A }, T)), [A, B, C]);
assert.deepEqual(queueIds(applyQueueOp(q, { type: "up", id: B }, T)), [B, A, C]);
assert.deepEqual(queueIds(applyQueueOp(q, { type: "up", id: A }, T)), [A, B, C]);
assert.deepEqual(queueIds(applyQueueOp(q, { type: "down", id: A }, T)), [B, A, C]);
assert.deepEqual(queueIds(applyQueueOp(q, { type: "down", id: C }, T)), [A, B, C]);
assert.deepEqual(queueIds(applyQueueOp(q, { type: "remove", id: B }, T)), [A, C]);
assert.deepEqual(queueIds(applyQueueOp(q, { type: "remove", id: D }, T)), [A, B, C]);
assert.deepEqual(queueIds(applyQueueOp(q, { type: "reorder", ids: [C, A, B] }, T)), [C, A, B]);
// reorder from a device that has not seen a newer add: the newer item survives
assert.deepEqual(queueIds(applyQueueOp(q, { type: "reorder", ids: [C, A] }, T)), [C, A, B]);
// reorder ignores unknown ids and duplicates
assert.deepEqual(queueIds(applyQueueOp(q, { type: "reorder", ids: [C, D, C, B, A] }, T)), [C, B, A]);
assert.deepEqual(queueIds(applyQueueOp(q, { type: "nope" }, T)), [A, B, C]);

// cap + normalize
const big = { items: Array.from({ length: MAX_QUEUE + 50 }, (_, i) => ({ id: String(i).padStart(11, "x") })) };
assert.equal(normalizeQueue(big).items.length, MAX_QUEUE);
assert.deepEqual(normalizeQueue(null), emptyQueue());
assert.deepEqual(queueIds(normalizeQueue({ items: [A, { id: A }, { id: "bad" }, B] })), [A, B]);

// ---- Done leaves the queue; Dropped and unknown ids stay
const videos = [
  { id: A, watchedPct: 100, remainingSec: 0, droppedAt: null },
  { id: B, watchedPct: 60, remainingSec: 300, droppedAt: "2026-10-01T00:00:00.000Z" },
  { id: C, watchedPct: 94, remainingSec: 120, droppedAt: null },
];
const pruned = pruneDoneFromQueue(
  { items: [{ id: A }, { id: B }, { id: C }, { id: D }] },
  videos,
  T,
);
assert.deepEqual(pruned.removed, [A]);
assert.deepEqual(queueIds(pruned.queue), [B, C, D], "dropped + unknown kept");
assert.deepEqual(pruneDoneFromQueue({ items: [{ id: C }] }, videos).removed, []);

// ---- a library sync never rewrites queue data (dropped videos included)
const prevLibrary = [
  { id: A, title: "A", author: "x", durationSec: 600, watchedPct: 10, droppedAt: null, savedRank: 0 },
  { id: B, title: "B", author: "x", durationSec: 600, watchedPct: 10, droppedAt: null, savedRank: 1 },
];
const merged = mergeWatchLaterLibrary(prevLibrary, [{ id: A, title: "A", author: "x", durationSec: 600, watchedPct: 10 }], T, {});
assert.ok(merged.library.videos.some((v) => v.id === B && v.droppedAt), "B is now Dropped");
assert.ok(!("queue" in merged.library) && merged.library.videos.every((v) => !("queued" in v)));

function memorySdk() {
  const files = new Map();
  const puts = [];
  return {
    files,
    puts,
    async get(path) {
      if (!files.has(path)) return null;
      return {
        statusCode: 200,
        stream: new Blob([files.get(path)], { type: "application/json" }).stream(),
      };
    },
    async put(path, body) {
      puts.push(path);
      files.set(path, body);
      return { pathname: path };
    },
  };
}

delete process.env.BLOB_READ_WRITE_TOKEN;
await assert.rejects(() => loadQueue(), /BLOB_READ_WRITE_TOKEN/);
await assert.rejects(() => saveQueue(emptyQueue()), /BLOB_READ_WRITE_TOKEN/);
assert.equal(await pruneQueueForLibrary(videos), null, "prune never throws without a token");

process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_token_not_real";
const sdk = memorySdk();
assert.deepEqual(queueIds(await loadQueue(sdk)), [], "missing blob = empty queue");
await saveQueue(applyQueueOp(emptyQueue(), { type: "add", id: B }, T), sdk);
await saveQueue(applyQueueOp(await loadQueue(sdk), { type: "add", id: A }, T), sdk);
assert.deepEqual(queueIds(await loadQueue(sdk)), [B, A]);
assert.ok(sdk.puts.every((path) => path === "watch-later/queue.json"));

// library writes use a different blob and leave the queue file untouched
const before = sdk.files.get("watch-later/queue.json");
await saveLiveLibrary(merged.library, sdk);
assert.equal(sdk.files.get("watch-later/queue.json"), before);
assert.ok(sdk.files.has("watch-later/library.json"));

// the post-sync prune removes only Done (A is Done in `videos`), keeps Dropped B
const result = await pruneQueueForLibrary(videos, sdk);
assert.deepEqual(result.removed, [A]);
assert.deepEqual(queueIds(await loadQueue(sdk)), [B]);

// ---- API handler guards (no storage reached)
const { default: handler } = await import("../api/queue.js");
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
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
      end(payload) {
        resolve({ status: this.statusCode, body: payload ? JSON.parse(payload) : null });
      },
    };
    handler(req, res);
  });
}

delete process.env.BLOB_READ_WRITE_TOKEN;
assert.equal((await call("GET")).status, 503, "no storage = 503, UI degrades");
assert.equal((await call("DELETE")).status, 405);
assert.equal(
  (await call("POST", { headers: { host: "a.example", origin: "https://evil.example" }, body: { op: { type: "add", id: A } } })).status,
  403,
);
assert.equal((await call("POST", { body: { op: { type: "boom" } } })).status, 400);
assert.equal((await call("POST", { body: { op: { type: "add", id: "bad" } } })).status, 400);
assert.equal((await call("POST", { body: { op: { type: "reorder", ids: ["bad"] } } })).status, 400);

import { readFileSync } from "node:fs";
const librarySrc = readFileSync(new URL("../src/lib/library.ts", import.meta.url), "utf8");
assert.match(librarySrc, /statuses: \[\],\n  includeDropped: false,\n  categories: \[\],/, "default view stays unfiltered");
const appSrc = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
assert.match(appSrc, /useState<LibraryView>\("all"\)/, "app opens on All, not Queue");

console.log(
  "queue tests: add/remove/top/up/down/reorder, stale-device reorder, Done pruned, Dropped kept, sync leaves queue blob alone, API guards ok",
);
