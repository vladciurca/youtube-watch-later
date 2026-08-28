import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeWatchLaterLibrary } from "../api/_lib/merge.mjs";
import {
  formatRemaining,
  parsePublishedRelative,
  remainingSecFrom,
  statusFromWatchedPct,
} from "../api/_lib/progress.mjs";
import { classifyCategory, classifyTechBusiness, majorityTechChannels, resolveCategory, resolveTechBusiness } from "../api/_lib/categorize.mjs";

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
assert.deepEqual(selectStatus(["tech"], "health"), ["health"]);
assert.deepEqual(selectStatus(["tech"], "tech"), []);

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
assert.equal(byId[returning.id].category, returning.techBusiness ? "tech" : returning.category);
assert.equal(byId[returning.id].status, "Partially watched");
assert.equal(byId[returning.id].droppedAt, null);
assert.equal(byId[returning.id].remainingSec, remainingSecFrom(returning.durationSec, 55));
assert.equal(byId[sample[1].id].status, "Barely started");
assert.equal(byId[missing.id].droppedAt, syncedAt);
assert.equal(byId[missing.id].title, missing.title);
assert.equal(byId.AAAAAAAAAAA.techBusiness, false);
assert.equal(byId.AAAAAAAAAAA.category, "other");
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

const vid = (id, extra = {}) => ({
  id,
  title: extra.title || id,
  author: extra.author || "Channel",
  durationSec: extra.durationSec ?? 120,
  duration: extra.duration || "2:00",
  watchedPct: extra.watchedPct ?? 0,
  ...extra,
});

// savedRank from playlistVideoRenderer.index (1-based → 0-based), not scrape insertion order
const { library: fromIndex } = mergeWatchLaterLibrary(
  [],
  [
    vid("ccccccccccc", { title: "Third", index: 3 }),
    vid("aaaaaaaaaaa", { title: "First", index: 1 }),
    vid("bbbbbbbbbbb", { title: "Second", savedRank: 1 }),
  ],
  syncedAt,
);
const fromIndexById = Object.fromEntries(fromIndex.videos.map((video) => [video.id, video]));
assert.equal(fromIndexById.aaaaaaaaaaa.savedRank, 0);
assert.equal(fromIndexById.bbbbbbbbbbb.savedRank, 1);
assert.equal(fromIndexById.ccccccccccc.savedRank, 2);

// publishedAt parse at scrape/merge time; preserve previous if a later scrape omits it
const now = Date.parse("2026-08-27T20:00:00.000Z");
assert.equal(
  parsePublishedRelative("4 weeks ago", now),
  new Date(now - 4 * 7 * 86_400_000).toISOString(),
);
assert.equal(
  parsePublishedRelative("Streamed 5 hours ago", now),
  new Date(now - 5 * 3_600_000).toISOString(),
);
assert.equal(parsePublishedRelative("not a date", now), null);

const { library: withPublished } = mergeWatchLaterLibrary(
  [],
  [vid("ddddddddddd", { publishedTimeText: "4 weeks ago" })],
  syncedAt,
);
assert.equal(withPublished.videos[0].publishedLabel, "4 weeks ago");
assert.ok(withPublished.videos[0].publishedAt);
assert.equal(
  withPublished.videos[0].publishedAt,
  parsePublishedRelative("4 weeks ago", Date.parse(withPublished.videos[0].publishedAt) + 4 * 7 * 86_400_000),
);

const { library: omittedPublished } = mergeWatchLaterLibrary(
  withPublished.videos,
  [vid("ddddddddddd")],
  "2026-08-27T21:00:00.000Z",
);
assert.equal(omittedPublished.videos[0].publishedAt, withPublished.videos[0].publishedAt);
assert.equal(omittedPublished.videos[0].publishedLabel, "4 weeks ago");

function comparePublished(a, b) {
  const aTime = Date.parse(a.publishedAt || "");
  const bTime = Date.parse(b.publishedAt || "");
  const aOk = Number.isFinite(aTime);
  const bOk = Number.isFinite(bTime);
  if (aOk !== bOk) return aOk ? -1 : 1;
  if (!aOk && !bOk) return a.title.localeCompare(b.title);
  return bTime - aTime || a.title.localeCompare(b.title);
}
const publishedSorted = [
  { id: "old", title: "Old", publishedAt: "2024-01-01T00:00:00.000Z" },
  { id: "new", title: "New", publishedAt: "2026-08-01T00:00:00.000Z" },
  { id: "missing", title: "Missing", publishedAt: null },
].sort(comparePublished);
assert.deepEqual(publishedSorted.map((video) => video.id), ["new", "old", "missing"]);

// Categorize new/untagged from channel majority + keywords; keep existing tags
const taggedLibrary = [
  { id: "ycvid000001", title: "YC talk", author: "Y Combinator", techBusiness: true },
  { id: "ycvid000002", title: "Another YC", author: "Y Combinator", techBusiness: true },
  { id: "lexvid00001", title: "Chat", author: "Lex Fridman", techBusiness: false },
];
const channels = majorityTechChannels(taggedLibrary);
assert.equal(channels.has("y combinator"), true);
assert.equal(channels.has("lex fridman"), false);
assert.equal(classifyTechBusiness({ title: "Hello", author: "Y Combinator" }, channels), true);
assert.equal(classifyTechBusiness({ title: "Raising a SaaS round", author: "Unknown" }, channels), true);
assert.equal(classifyTechBusiness({ title: "Piano practice", author: "Someone" }, channels), false);

assert.equal(
  resolveTechBusiness({ techBusiness: false }, { title: "AI startup", author: "Y Combinator" }, channels),
  false,
);
assert.equal(
  resolveTechBusiness({ techBusiness: true }, { title: "Cooking", author: "Lex Fridman" }, channels),
  true,
);
assert.equal(
  resolveTechBusiness(undefined, { title: "New YC video", author: "Y Combinator" }, channels),
  true,
);

const { library: categorized } = mergeWatchLaterLibrary(
  taggedLibrary,
  [
    vid("ycvid000001", { title: "YC talk", author: "Y Combinator", watchedPct: 10 }),
    vid("lexvid00001", { title: "Chat", author: "Lex Fridman", watchedPct: 10 }),
    vid("newycvideo1", { title: "Office Hours", author: "Y Combinator" }),
    vid("keywordvid1", { title: "How we built our SaaS", author: "New Channel" }),
    vid("piano000001", { title: "Piano practice", author: "Someone" }),
  ],
  syncedAt,
);
const catById = Object.fromEntries(categorized.videos.map((video) => [video.id, video]));
assert.equal(catById.ycvid000001.techBusiness, true);
assert.equal(catById.ycvid000001.category, "tech");
assert.equal(catById.lexvid00001.techBusiness, false);
assert.equal(catById.newycvideo1.techBusiness, true);
assert.equal(catById.newycvideo1.category, "tech");
assert.equal(catById.keywordvid1.techBusiness, true);
assert.equal(catById.piano000001.techBusiness, false);
assert.equal(catById.piano000001.category, "other");

assert.equal(
  classifyCategory({ title: "Is Sauna ACTUALLY Good For You?", author: "Bryan Johnson" }),
  "health",
);
assert.equal(
  classifyCategory({ title: "This is Why Modern Dating Is Failing", author: "Scott Galloway" }),
  "dating",
);
assert.equal(
  classifyCategory({ title: "Echo Valley — Official Trailer | Apple TV", author: "Apple TV" }),
  "trailers",
);
assert.equal(
  classifyCategory({ title: "10 Packable Backpacks for Minimalist Travel", author: "Pack Hacker" }),
  "travel",
);
assert.equal(
  resolveCategory(
    { techBusiness: true, category: "tech" },
    { title: "Sauna and sleep protocol", author: "Bryan Johnson" },
    {},
  ),
  "tech",
);
assert.equal(
  resolveCategory(
    { techBusiness: false },
    { title: "How I FIXED My Terrible Sleep", author: "Bryan Johnson" },
    {},
  ),
  "health",
);

const { library: moreCats } = mergeWatchLaterLibrary(
  taggedLibrary,
  [
    vid("healthvid01", { title: "Sauna protocol", author: "Bryan Johnson" }),
    vid("datevid0001", { title: "A Divorce Attorney's Thoughts On Love", author: "James Sexton" }),
    vid("trailvid001", { title: "Crime 101 | Official Trailer", author: "Amazon MGM Studios" }),
    vid("packvid0001", { title: "5 Things Experienced Travelers Don't Pack", author: "Pack Hacker" }),
  ],
  syncedAt,
);
const moreById = Object.fromEntries(moreCats.videos.map((video) => [video.id, video]));
assert.equal(moreById.healthvid01.category, "health");
assert.equal(moreById.datevid0001.category, "dating");
assert.equal(moreById.trailvid001.category, "trailers");
assert.equal(moreById.packvid0001.category, "travel");

assert.match(libraryTs, /categories: \["tech"\]/);
assert.match(libraryTs, /label: "Health \/ longevity"/);

assert.equal(formatRemaining(0), "Done");
assert.equal(formatRemaining(360), "6:00 left");
assert.equal(formatRemaining(6), "0:06 left");
assert.equal(formatRemaining(3840), "1h 4m left");
assert.equal(formatRemaining(3600), "1h left");
assert.match(libraryTs, /\$\{m\}:\$\{String\(s\)\.padStart\(2, "0"\)\} left/);
assert.match(libraryTs, /key: "published", label: "Published"/);

function mergeId(i) {
  return `v${String(i).padStart(10, "0")}`;
}

function previousLibraryVideo(i, extra = {}) {
  return {
    id: mergeId(i),
    title: `Previous ${i}`,
    author: "Channel",
    duration: "2:00",
    durationSec: 120,
    watchedPct: 0,
    status: "Not started",
    techBusiness: false,
    category: "other",
    t: 0,
    url: `https://www.youtube.com/watch?v=${mergeId(i)}`,
    remainingSec: 120,
    droppedAt: null,
    savedRank: i,
    ...extra,
  };
}

function scrapedLibraryVideo(i) {
  return vid(mergeId(i), { title: `Scraped ${i}` });
}

const previous665 = Array.from({ length: 665 }, (_, i) => previousLibraryVideo(i));
const scrape100 = Array.from({ length: 100 }, (_, i) => scrapedLibraryVideo(i));
const { library: truncatedLib, stats: truncatedStats } = mergeWatchLaterLibrary(
  previous665,
  scrape100,
  "2026-08-28T12:00:00.000Z",
);
assert.equal(truncatedStats.upserted, 100);
assert.equal(truncatedStats.partial, true);
assert.equal(truncatedLib.partial, true);
assert.equal(
  truncatedLib.videos.filter((video) => video.droppedAt == null).length,
  665,
);
assert.equal(
  truncatedLib.videos.filter((video) => video.droppedAt != null).length,
  0,
);
assert.equal(truncatedLib.videos.find((video) => video.id === mergeId(100)).droppedAt, null);
assert.equal(truncatedLib.videos.find((video) => video.id === mergeId(0)).title, "Scraped 0");

const scrape650 = Array.from({ length: 650 }, (_, i) => scrapedLibraryVideo(i));
const { library: fullishLib, stats: fullishStats } = mergeWatchLaterLibrary(
  previous665,
  scrape650,
  "2026-08-28T12:05:00.000Z",
);
assert.equal(fullishStats.partial, false);
assert.equal(fullishLib.partial, false);
assert.equal(
  fullishLib.videos.filter((video) => video.droppedAt == null).length,
  650,
);
assert.equal(
  fullishLib.videos.filter((video) => video.droppedAt === "2026-08-28T12:05:00.000Z").length,
  15,
);
assert.equal(fullishLib.videos.find((video) => video.id === mergeId(650)).droppedAt, "2026-08-28T12:05:00.000Z");
assert.equal(fullishLib.videos.find((video) => video.id === mergeId(664)).droppedAt, "2026-08-28T12:05:00.000Z");
assert.equal(fullishLib.videos.find((video) => video.id === mergeId(0)).droppedAt, null);

assert.equal(library.partial, false);

console.log(
  "library tests: exclusive chips, remaining sort, upsert, dropped, savedRank, publishedAt, categorize, formatRemaining, partial scrape guard ok",
);
