import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isPartialWatchLaterScrape, mergeWatchLaterLibrary } from "../api/_lib/merge.mjs";
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
  const aDropped = a.droppedAt != null;
  const bDropped = b.droppedAt != null;
  if (aDropped !== bDropped) return aDropped ? 1 : -1;

  const aRanked = hasSavedRank(a);
  const bRanked = hasSavedRank(b);
  if (aRanked !== bRanked) return aRanked ? -1 : 1;
  if (!aRanked || !bRanked) return 0;
  if (a.savedRank !== b.savedRank) return a.savedRank - b.savedRank;
  return 0;
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
assert.deepEqual(
  seedSaved.map((video) => video.id),
  seed.videos.map((video) => video.id),
);
assert.match(libraryTs, /if \(!aRanked \|\| !bRanked\) return 0/);
assert.doesNotMatch(libraryTs, /if \(!aRanked && !bRanked\) return compareRemaining/);

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

// Playlist order is the scraped array order. A repeated index of 1 must not
// pull a later video up to savedRank 0 (that is what put Brian Singerman first).
const { library: fromIndex } = mergeWatchLaterLibrary(
  [],
  [
    vid("ccccccccccc", { title: "Third in list", index: 1, savedRank: 0 }),
    vid("aaaaaaaaaaa", { title: "First in list", index: 1 }),
    vid("bbbbbbbbbbb", { title: "Second in list", savedRank: 50 }),
  ],
  syncedAt,
);
const fromIndexById = Object.fromEntries(fromIndex.videos.map((video) => [video.id, video]));
assert.equal(fromIndexById.ccccccccccc.savedRank, 0);
assert.equal(fromIndexById.aaaaaaaaaaa.savedRank, 1);
assert.equal(fromIndexById.bbbbbbbbbbb.savedRank, 2);

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
assert.equal(
  parsePublishedRelative("4mo ago", now),
  new Date(now - 4 * 30 * 86_400_000).toISOString(),
);
assert.equal(
  parsePublishedRelative("2y ago", now),
  new Date(now - 2 * 365 * 86_400_000).toISOString(),
);

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
const previous676 = Array.from({ length: 676 }, (_, i) => previousLibraryVideo(i));
const { library: truncated676Lib, stats: truncated676Stats } = mergeWatchLaterLibrary(
  previous676,
  scrape100,
  "2026-09-03T18:17:58.025Z",
);
assert.equal(truncated676Stats.partial, true);
assert.equal(truncated676Lib.partial, true);
assert.equal(
  truncated676Lib.videos.filter((video) => video.droppedAt == null).length,
  676,
);
assert.equal(
  truncated676Lib.videos.filter((video) => video.droppedAt != null).length,
  0,
);

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
assert.equal(stats.resetDropped, false);
assert.equal(stats.clearedDropped, 0);

const sidebarTs = readFileSync(join(root, "../src/components/Sidebar.tsx"), "utf8");
assert.match(sidebarTs, /Not in the last full YouTube WL scrape/);
assert.match(sidebarTs, /not something you marked/);

const popupJs = readFileSync(join(root, "../extension/popup.js"), "utf8");
const backgroundJs = readFileSync(join(root, "../extension/background.js"), "utf8");
const manifest = JSON.parse(readFileSync(join(root, "../extension/manifest.json"), "utf8"));
const syncJs = readFileSync(join(root, "../api/sync.js"), "utf8");
assert.equal(manifest.version, "1.3.0");
assert.match(backgroundJs, /previousOnListCount/);
assert.match(backgroundJs, /statedCount/);
assert.match(syncJs, /body\.statedCount/);
assert.match(syncJs, /body\.resetDropped === true/);
assert.match(popupJs, /Scraped \$\{scrapedCount\}/);
assert.match(popupJs, /\(stated\)/);
assert.match(popupJs, /method \$\{result\.method\}/);
assert.match(backgroundJs, /resetDroppedPending/);
assert.match(backgroundJs, /resetDropped: true/);
assert.match(popupJs, /Restoring Dropped from the incomplete first-page scrape/);

// After the first-page massacre, previousOnList is ~100, so a later 100-video
// scrape is NOT partial and keeps already-stamped droppedAt.
const massacreOnList = Array.from({ length: 100 }, (_, i) => previousLibraryVideo(i));
const massacreDropped = Array.from({ length: 575 }, (_, i) =>
  previousLibraryVideo(i + 100, { droppedAt: "2026-08-28T11:52:57.036Z" }),
);
const massacreLibrary = [...massacreOnList, ...massacreDropped];
const scrapeFirstPage = Array.from({ length: 100 }, (_, i) => scrapedLibraryVideo(i));
const { library: stillDroppedLib, stats: stillDroppedStats } = mergeWatchLaterLibrary(
  massacreLibrary,
  scrapeFirstPage,
  "2026-08-30T05:54:57.048Z",
);
assert.equal(stillDroppedStats.partial, false);
assert.equal(stillDroppedStats.resetDropped, false);
assert.equal(
  stillDroppedLib.videos.filter((video) => video.droppedAt != null).length,
  575,
);
assert.equal(
  stillDroppedLib.videos.find((video) => video.id === mergeId(100)).droppedAt,
  "2026-08-28T11:52:57.036Z",
);

// resetDropped then a partial scrape must not re-drop the restored videos
const { library: resetPartialLib, stats: resetPartialStats } = mergeWatchLaterLibrary(
  massacreLibrary,
  scrapeFirstPage,
  "2026-08-31T12:00:00.000Z",
  { resetDropped: true },
);
assert.equal(resetPartialStats.resetDropped, true);
assert.equal(resetPartialStats.clearedDropped, 575);
assert.equal(resetPartialStats.partial, true);
assert.equal(resetPartialStats.dropped, 0);
assert.equal(
  resetPartialLib.videos.filter((video) => video.droppedAt == null).length,
  675,
);
assert.equal(resetPartialLib.videos.find((video) => video.id === mergeId(100)).droppedAt, null);
assert.equal(resetPartialLib.videos.find((video) => video.id === mergeId(0)).title, "Scraped 0");

// resetDropped then a full scrape re-drops videos absent from that scrape
const scrapeFull = Array.from({ length: 650 }, (_, i) => scrapedLibraryVideo(i));
const { library: resetFullLib, stats: resetFullStats } = mergeWatchLaterLibrary(
  massacreLibrary,
  scrapeFull,
  "2026-08-31T12:05:00.000Z",
  { resetDropped: true },
);
assert.equal(resetFullStats.resetDropped, true);
assert.equal(resetFullStats.clearedDropped, 575);
assert.equal(resetFullStats.partial, false);
assert.equal(resetFullStats.dropped, 25);
assert.equal(
  resetFullLib.videos.filter((video) => video.droppedAt == null).length,
  650,
);
assert.equal(
  resetFullLib.videos.find((video) => video.id === mergeId(650)).droppedAt,
  "2026-08-31T12:05:00.000Z",
);
assert.equal(resetFullLib.videos.find((video) => video.id === mergeId(0)).droppedAt, null);
assert.equal(resetFullLib.videos.find((video) => video.id === mergeId(100)).droppedAt, null);

// Partial scrape: scraped order wins even when a later video claims rank/index 0.
// Videos missing from the scrape keep their previous relative order after it.
const partialPrev = [
  vid("aaaaaaaaaaa", { title: "Fostul patron", savedRank: 0, durationSec: 1000, watchedPct: 0 }),
  vid("bbbbbbbbbbb", { title: "Kept earlier", savedRank: 1, durationSec: 100, watchedPct: 0 }),
  vid("ccccccccccc", { title: "Kept later", savedRank: 5, durationSec: 10, watchedPct: 90 }),
  vid("ddddddddddd", {
    title: "No previous rank",
    durationSec: 50,
    watchedPct: 0,
    publishedAt: "2026-10-01T00:00:00.000Z",
  }),
];
const { library: partialOrder, stats: partialOrderStats } = mergeWatchLaterLibrary(
  partialPrev,
  [
    vid("aaaaaaaaaaa", { title: "Fostul patron", savedRank: 4, index: 9 }),
    vid("eeeeeeeeeee", {
      title: "Brian Singerman on Founders Fund, GPx, and Looking for Greatness | Ep. 56",
      savedRank: 0,
      index: 1,
    }),
  ],
  syncedAt,
  { statedCount: 692 },
);
assert.equal(partialOrderStats.partial, true);
assert.equal(partialOrderStats.dropped, 0);
assert.equal(partialOrderStats.statedCount, 692);
assert.deepEqual(
  partialOrder.videos.map((video) => video.id),
  ["aaaaaaaaaaa", "eeeeeeeeeee", "bbbbbbbbbbb", "ccccccccccc", "ddddddddddd"],
);
assert.deepEqual(
  partialOrder.videos.map((video) => video.savedRank),
  [0, 1, 2, 3, 4],
);
const partialSorted = [...partialOrder.videos].sort(compareSaved).map((video) => video.id);
assert.deepEqual(partialSorted, [
  "aaaaaaaaaaa",
  "eeeeeeeeeee",
  "bbbbbbbbbbb",
  "ccccccccccc",
  "ddddddddddd",
]);

// Equal savedRank keeps list order. Title and remaining time do not float Brian first.
const tied = [
  { id: "fostul", title: "Fostul patron", savedRank: 0, remainingSec: 3000, droppedAt: null },
  {
    id: "brian",
    title: "Brian Singerman on Founders Fund",
    savedRank: 0,
    remainingSec: 10,
    droppedAt: null,
    publishedAt: "2026-09-01T00:00:00.000Z",
  },
  {
    id: "tailLate",
    title: "Tail with lots left",
    remainingSec: 9000,
    droppedAt: null,
    publishedAt: "2020-01-01T00:00:00.000Z",
  },
  {
    id: "tailSoon",
    title: "Tail almost done",
    remainingSec: 1,
    droppedAt: null,
    publishedAt: "2026-10-01T00:00:00.000Z",
  },
];
assert.deepEqual([...tied].sort(compareSaved).map((video) => video.id), [
  "fostul",
  "brian",
  "tailLate",
  "tailSoon",
]);

assert.equal(
  isPartialWatchLaterScrape(Array.from({ length: 100 }, (_, i) => previousLibraryVideo(i)), 98, 100),
  false,
);
assert.equal(
  isPartialWatchLaterScrape(Array.from({ length: 100 }, (_, i) => previousLibraryVideo(i)), 97, 100),
  true,
);
assert.equal(
  isPartialWatchLaterScrape(Array.from({ length: 692 }, (_, i) => previousLibraryVideo(i)), 117, 692),
  true,
);

const headerTs = readFileSync(join(root, "../src/components/Header.tsx"), "utf8");
const indexCss = readFileSync(join(root, "../src/index.css"), "utf8");
const indexHtml = readFileSync(join(root, "../index.html"), "utf8");
const manifestWeb = JSON.parse(readFileSync(join(root, "../public/manifest.webmanifest"), "utf8"));

function activeFilterCount(filters) {
  const query = filters.query.trim() ? 1 : 0;
  const dropped = filters.includeDropped ? 1 : 0;
  return filters.statuses.length + filters.categories.length + dropped + query;
}

assert.match(libraryTs, /export function activeFilterCount/);
assert.equal(
  activeFilterCount({
    statuses: ["Almost finished"],
    includeDropped: false,
    categories: ["tech"],
    query: "",
    sort: "saved",
  }),
  2,
);
assert.equal(
  activeFilterCount({
    statuses: [],
    includeDropped: true,
    categories: [],
    query: "fund",
    sort: "published",
  }),
  2,
);
assert.match(headerTs, /filters-badge/);
assert.match(headerTs, /mobile-tools/);
assert.match(headerTs, /Sync incomplete\. Missing videos were kept/);
assert.match(indexCss, /env\(safe-area-inset-top\)/);
assert.match(indexCss, /env\(safe-area-inset-bottom\)/);
assert.match(indexCss, /translateY\(110%\)/);
assert.match(indexCss, /min-height: 40px/);
assert.match(indexHtml, /viewport-fit=cover/);
assert.match(indexHtml, /apple-touch-icon/);
assert.equal(manifestWeb.display, "standalone");
assert.ok(manifestWeb.icons.some((icon) => icon.sizes === "180x180"));
assert.ok(manifestWeb.icons.some((icon) => icon.sizes === "512x512"));

console.log(
  "library tests: exclusive chips, remaining sort, upsert, dropped, savedRank, publishedAt, categorize, formatRemaining, partial scrape guard, resetDropped repair, phone layout ok",
);
