import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeWatchLaterLibrary } from "../api/_lib/merge.mjs";
import {
  remainingSecFrom,
  statusFromWatchedPct,
} from "../api/_lib/progress.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(
  readFileSync(join(root, "../public/data/videos.json"), "utf8"),
);

function selectStatus(current, status) {
  const already = current.length === 1 && current[0] === status;
  return already ? [] : [status];
}

function compareRemaining(a, b) {
  const aDone = a.remainingSec <= 0;
  const bDone = b.remainingSec <= 0;
  if (aDone !== bDone) return aDone ? 1 : -1;
  return a.remainingSec - b.remainingSec || a.title.localeCompare(b.title);
}

function compareWatched(a, b) {
  return b.watchedPct - a.watchedPct || a.title.localeCompare(b.title);
}

function hasSavedRank(video) {
  return Number.isFinite(video.savedRank);
}

function compareSaved(a, b) {
  const aRanked = hasSavedRank(a);
  const bRanked = hasSavedRank(b);
  if (!aRanked && !bRanked) return compareRemaining(a, b);

  const aDropped = a.droppedAt != null;
  const bDropped = b.droppedAt != null;
  if (aDropped !== bDropped) return aDropped ? 1 : -1;

  if (aRanked !== bRanked) return aRanked ? -1 : 1;
  return a.savedRank - b.savedRank || a.title.localeCompare(b.title);
}

// Exclusive status chips
assert.deepEqual(selectStatus(["Almost finished"], "Partially watched"), [
  "Partially watched",
]);
assert.deepEqual(selectStatus(["Almost finished"], "Almost finished"), []);
assert.deepEqual(selectStatus([], "Barely started"), ["Barely started"]);

// Remaining vs Watched % on the default Almost finished + Tech/Business view
const defaultView = seed.videos.filter(
  (video) => video.status === "Almost finished" && video.techBusiness,
);
const leftover = defaultView.filter((video) => video.remainingSec > 0);
const done = defaultView.filter((video) => video.remainingSec <= 0);
assert.ok(leftover.length > 0, "expected unfinished Almost finished videos");
assert.ok(done.length > 0, "expected Done videos in Almost finished");

const remainingOrder = [...defaultView].sort(compareRemaining);
const watchedOrder = [...defaultView].sort(compareWatched);

assert.equal(remainingOrder[0].remainingSec > 0, true);
assert.ok(
  remainingOrder[0].remainingSec <=
    Math.min(...leftover.map((video) => video.remainingSec)),
);
assert.equal(remainingOrder.at(-1).remainingSec <= 0, true);
assert.equal(watchedOrder[0].watchedPct, 100);
assert.notEqual(remainingOrder[0].id, watchedOrder[0].id);

const leftoverBeforeDone = remainingOrder.findIndex((video) => video.remainingSec <= 0);
assert.ok(leftoverBeforeDone === leftover.length);

// Status buckets
assert.equal(statusFromWatchedPct(100), "Almost finished");
assert.equal(statusFromWatchedPct(90), "Almost finished");
assert.equal(statusFromWatchedPct(89), "Partially watched");
assert.equal(statusFromWatchedPct(40), "Partially watched");
assert.equal(statusFromWatchedPct(39), "Barely started");
assert.equal(statusFromWatchedPct(10), "Barely started");
assert.equal(statusFromWatchedPct(9), "Not started");
assert.equal(statusFromWatchedPct(0), "Not started");

// Live upsert: preserve seed tags, recompute progress, mark missing as Dropped
const sample = seed.videos.slice(0, 3);
const missing = sample[2];
const returning = {
  ...sample[0],
  watchedPct: 55,
  droppedAt: "2026-01-01T00:00:00.000Z",
};
const scraped = [
  {
    id: returning.id,
    title: returning.title,
    author: returning.author,
    durationSec: returning.durationSec,
    duration: returning.duration,
    watchedPct: 55,
  },
  {
    id: sample[1].id,
    title: sample[1].title,
    author: sample[1].author,
    durationSec: sample[1].durationSec,
    duration: sample[1].duration,
    watchedPct: 12,
  },
  {
    id: "AAAAAAAAAAA",
    title: "Brand new WL video",
    author: "Someone",
    durationSec: 200,
    duration: "3:20",
    watchedPct: 0,
  },
];

const syncedAt = "2026-08-27T20:00:00.000Z";
const { library, stats } = mergeWatchLaterLibrary(sample, scraped, syncedAt);

assert.equal(stats.upserted, 3);
assert.equal(stats.dropped, 1);
const byId = Object.fromEntries(library.videos.map((video) => [video.id, video]));

assert.equal(byId[returning.id].techBusiness, returning.techBusiness);
assert.equal(byId[returning.id].status, "Partially watched");
assert.equal(byId[returning.id].droppedAt, null);
assert.equal(byId[returning.id].remainingSec, remainingSecFrom(returning.durationSec, 55));
assert.equal(byId[sample[1].id].status, "Barely started");
assert.equal(byId[missing.id].droppedAt, syncedAt);
assert.equal(byId[missing.id].title, missing.title);
assert.equal(byId.AAAAAAAAAAA.techBusiness, false);
assert.equal(byId.AAAAAAAAAAA.status, "Not started");
assert.equal(library.live, true);
assert.equal(library.syncedAt, syncedAt);
assert.equal(byId[returning.id].savedRank, 0);
assert.equal(byId[sample[1].id].savedRank, 1);
assert.equal(byId.AAAAAAAAAAA.savedRank, 2);
assert.equal(byId[missing.id].savedRank, undefined);

const resorted = [
  scraped[2],
  scraped[0],
  scraped[1],
];
const { library: reranked } = mergeWatchLaterLibrary(
  library.videos,
  resorted,
  "2026-08-27T21:00:00.000Z",
);
const rerankedById = Object.fromEntries(
  reranked.videos.map((video) => [video.id, video]),
);
assert.equal(rerankedById.AAAAAAAAAAA.savedRank, 0);
assert.equal(rerankedById[returning.id].savedRank, 1);
assert.equal(rerankedById[sample[1].id].savedRank, 2);
assert.equal(rerankedById[missing.id].savedRank, undefined);
assert.equal(rerankedById[missing.id].droppedAt, syncedAt);

const { library: afterDrop } = mergeWatchLaterLibrary(
  reranked.videos,
  [resorted[0], resorted[1]],
  "2026-08-27T22:00:00.000Z",
);
const afterDropById = Object.fromEntries(
  afterDrop.videos.map((video) => [video.id, video]),
);
assert.equal(afterDropById.AAAAAAAAAAA.savedRank, 0);
assert.equal(afterDropById[returning.id].savedRank, 1);
assert.equal(afterDropById[sample[1].id].savedRank, 2);
assert.equal(afterDropById[sample[1].id].droppedAt, "2026-08-27T22:00:00.000Z");

const libraryTs = readFileSync(join(root, "../src/lib/library.ts"), "utf8");
assert.match(libraryTs, /key: "saved", label: "Saved"/);
assert.match(libraryTs, /sort: "saved"/);

const seedSaved = [...seed.videos].sort(compareSaved);
const seedRemaining = [...seed.videos].sort(compareRemaining);
assert.deepEqual(
  seedSaved.map((video) => video.id),
  seedRemaining.map((video) => video.id),
);

const ranked = [
  { id: "c", title: "Oldest", remainingSec: 5, savedRank: 2, droppedAt: null },
  { id: "a", title: "Newest", remainingSec: 40, savedRank: 0, droppedAt: null },
  { id: "b", title: "Middle", remainingSec: 1, savedRank: 1, droppedAt: null },
  {
    id: "d",
    title: "Dropped old top",
    remainingSec: 10,
    savedRank: 0,
    droppedAt: "2026-08-27T22:00:00.000Z",
  },
];
assert.deepEqual([...ranked].sort(compareSaved).map((video) => video.id), [
  "a",
  "b",
  "c",
  "d",
]);

console.log("library tests: exclusive chips, remaining sort, upsert, dropped, savedRank ok");
