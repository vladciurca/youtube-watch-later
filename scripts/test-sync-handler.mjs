import assert from "node:assert/strict";
import { register } from "node:module";

// Register before api/sync.js is imported, so its dynamic @vercel/blob import
// hits the in-memory stub instead of the network.
await register("./blob-stub-hooks.mjs", import.meta.url);

const { default: handler } = await import("../api/sync.js");

const TEST_SECRET = "test-sync-secret";
const ZEEV_ID = "btt-7e0JIA4";
const KURT_ID = "u1cyLVmRMx8";
const ZEEV_TITLE = "How One Man Invests $2.7B With No Employees | Oren Zeev";

function libraryId(i) {
  return `v${String(i).padStart(10, "0")}`;
}

function existingVideo(i) {
  const kurt = i === 0;
  return {
    id: kurt ? KURT_ID : libraryId(i),
    title: kurt
      ? "Managing $525B & Building the World's Largest Multifamily Office | Kurt MacAlpine, Corient"
      : `Library video ${i}`,
    author: kurt ? "Channel" : "Channel",
    duration: kurt ? "1:19:35" : "1:00:00",
    durationSec: kurt ? 4775 : 3600,
    watchedPct: kurt ? 10 : 0,
    status: kurt ? "Barely started" : "Not started",
    droppedAt: null,
    savedRank: i,
  };
}

const existing = Array.from({ length: 702 }, (_, i) => existingVideo(i));
assert.equal(existing[0].id, KURT_ID);
assert.equal(existing.filter((video) => video.id === ZEEV_ID).length, 0);

const scraped = [
  {
    id: ZEEV_ID,
    title: ZEEV_TITLE,
    author: "The Peel with Turner Novak",
    duration: "1:34:39",
    durationSec: 5679,
    watchedPct: 40,
    savedRank: 0,
    publishedLabel: "4 days ago",
  },
  ...existing.map((video, index) => ({
    id: video.id,
    title: video.title,
    author: video.author,
    duration: video.duration,
    durationSec: video.durationSec,
    watchedPct: video.watchedPct,
    savedRank: index + 1,
  })),
];
assert.equal(scraped.length, 703);

const payload = { videos: scraped, statedCount: 703 };
const rawBody = JSON.stringify(payload);
assert.ok(Buffer.byteLength(rawBody) < 4_000_000, "703-video body must fit the sync limit");

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
            if (body !== undefined) listeners.data?.(Buffer.from(body));
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
      end(payloadText) {
        resolve({
          status: this.statusCode,
          body: payloadText ? JSON.parse(payloadText) : null,
        });
      },
    };
    handler(req, res);
  });
}

const previousSecret = process.env.SYNC_SECRET;
const previousToken = process.env.BLOB_READ_WRITE_TOKEN;
process.env.SYNC_SECRET = TEST_SECRET;
process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_token_not_real";
globalThis.__wlBlob = {
  store: {
    "watch-later/library.json": JSON.stringify({
      live: true,
      partial: true,
      syncedAt: "2026-10-26T11:34:00.000Z",
      videos: existing,
    }),
  },
  puts: [],
};

try {
  const denied = await call("POST", {
    headers: { "x-sync-secret": "wrong-secret" },
    body: rawBody,
  });
  assert.equal(denied.status, 401);
  assert.equal(denied.body.error, "Unauthorized");
  assert.equal(globalThis.__wlBlob.puts.length, 0, "a rejected secret must not write the library");

  const accepted = await call("POST", {
    headers: { "x-sync-secret": TEST_SECRET },
    body: rawBody,
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.ok, true);
  assert.equal(accepted.body.upserted, 703);
  assert.equal(accepted.body.partial, false);
  assert.equal(accepted.body.dropped, 0);
  assert.equal(accepted.body.statedCount, 703);
  assert.notEqual(accepted.body.syncedAt, "2026-10-26T11:34:00.000Z");

  assert.equal(globalThis.__wlBlob.puts.length, 1);
  assert.equal(globalThis.__wlBlob.puts[0], "watch-later/library.json");
  const saved = JSON.parse(globalThis.__wlBlob.store["watch-later/library.json"]);
  assert.equal(saved.partial, false);
  assert.equal(saved.videos.length, 703);
  assert.equal(saved.videos[0].id, ZEEV_ID);
  assert.equal(saved.videos[0].title, ZEEV_TITLE);
  assert.equal(saved.videos[0].author, "The Peel with Turner Novak");
  assert.equal(saved.videos[0].savedRank, 0);
  assert.equal(saved.videos[0].watchedPct, 40);
  assert.equal(saved.videos[0].status, "Partially watched");
  assert.equal(saved.videos[0].duration, "1:34:39");
  assert.equal(saved.videos[0].durationSec, 5679);
  const kurt = saved.videos.find((video) => video.id === KURT_ID);
  assert.ok(kurt, "Kurt MacAlpine row was dropped");
  assert.equal(kurt.savedRank, 1);
  assert.equal(kurt.watchedPct, 10);
  assert.equal(kurt.droppedAt, null);
} finally {
  if (previousSecret === undefined) delete process.env.SYNC_SECRET;
  else process.env.SYNC_SECRET = previousSecret;
  if (previousToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = previousToken;
  delete globalThis.__wlBlob;
}

console.log(
  "sync handler: 703-video payload including the Zeev row is accepted (partial false, savedRank 0); wrong secret is 401 and does not write",
);
