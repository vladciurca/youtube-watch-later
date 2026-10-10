import {
  majorityChannelsByCategory,
  resolveCategory,
} from "./categorize.mjs";
import {
  formatDuration,
  normalizeScrapedVideo,
  remainingSecFrom,
  resumeTimeFrom,
  statusFromWatchedPct,
} from "./progress.mjs";

const PARTIAL_SYNC_MIN_PREVIOUS = 50;
const PARTIAL_SYNC_RATIO = 0.8;
const STATED_COMPLETE_RATIO = 0.98;

export function isPartialWatchLaterScrape(existingVideos, scrapedCount, statedCount) {
  const stated = Number(statedCount);
  if (Number.isFinite(stated) && stated > 0) {
    return scrapedCount < STATED_COMPLETE_RATIO * stated;
  }
  const previousOnList = existingVideos.filter(
    (video) => video?.id && video.droppedAt == null,
  ).length;
  return (
    previousOnList >= PARTIAL_SYNC_MIN_PREVIOUS &&
    scrapedCount < PARTIAL_SYNC_RATIO * previousOnList
  );
}

export function clearDroppedStamps(videos) {
  let cleared = 0;
  const next = videos.map((video) => {
    if (!video || video.droppedAt == null) return video;
    cleared += 1;
    return { ...video, droppedAt: null };
  });
  return { videos: next, cleared };
}

export function mergeWatchLaterLibrary(
  existingVideos,
  scrapedVideos,
  syncedAt,
  options = {},
) {
  const resetDropped = options.resetDropped === true;
  const prepared = resetDropped
    ? clearDroppedStamps(existingVideos).videos
    : existingVideos;
  const clearedDropped = resetDropped
    ? existingVideos.filter((video) => video?.droppedAt != null).length
    : 0;

  const previous = new Map();
  for (const video of prepared) {
    if (video?.id) previous.set(video.id, video);
  }

  const channelMaps = majorityChannelsByCategory(prepared);
  const seen = new Set();
  const videos = [];

  for (const raw of scrapedVideos) {
    const scraped = normalizeScrapedVideo(raw);
    if (!scraped || seen.has(scraped.id)) continue;
    seen.add(scraped.id);
    // Playlist order is the order the extension sent. A row index of 1 on a
    // later page must not become savedRank 0.
    const savedRank = seen.size - 1;

    const prev = previous.get(scraped.id);
    const durationSec = scraped.durationSec || prev?.durationSec || 0;
    const watchedPct = scraped.watchedPct;
    const title = scraped.title || prev?.title || scraped.id;
    const author = scraped.author || prev?.author || "";
    const duration =
      (scraped.duration && durationSec > 0 ? scraped.duration : null) ||
      prev?.duration ||
      formatDuration(durationSec);
    const publishedAt = scraped.publishedAt || prev?.publishedAt || null;
    const publishedLabel = scraped.publishedLabel || prev?.publishedLabel || null;
    const category = resolveCategory(prev, { title, author }, channelMaps);
    const techBusiness = category === "tech";

    videos.push({
      id: scraped.id,
      title,
      author,
      duration,
      durationSec,
      watchedPct,
      status: statusFromWatchedPct(watchedPct),
      techBusiness,
      category,
      t: resumeTimeFrom(durationSec, watchedPct, scraped.t),
      url: `https://www.youtube.com/watch?v=${scraped.id}`,
      remainingSec: remainingSecFrom(durationSec, watchedPct),
      droppedAt: null,
      savedRank,
      publishedAt,
      publishedLabel,
    });
  }

  const statedCount = Number(options.statedCount);
  const partial = isPartialWatchLaterScrape(
    prepared,
    seen.size,
    Number.isFinite(statedCount) && statedCount > 0 ? statedCount : null,
  );

  let dropped = 0;
  const missing = [];
  prepared.forEach((prev, originalIndex) => {
    if (!prev?.id || seen.has(prev.id)) return;
    if (partial && prev.droppedAt == null) {
      missing.push({ prev, originalIndex });
      return;
    }
    videos.push({
      ...prev,
      droppedAt: prev.droppedAt ?? syncedAt,
    });
    dropped += 1;
  });

  missing.sort((a, b) => {
    const aRanked = Number.isFinite(a.prev.savedRank);
    const bRanked = Number.isFinite(b.prev.savedRank);
    if (aRanked !== bRanked) return aRanked ? -1 : 1;
    if (aRanked && bRanked && a.prev.savedRank !== b.prev.savedRank) {
      return a.prev.savedRank - b.prev.savedRank;
    }
    return a.originalIndex - b.originalIndex;
  });
  let tailRank = seen.size;
  for (const { prev } of missing) {
    videos.push({ ...prev, savedRank: tailRank });
    tailRank += 1;
  }

  return {
    library: {
      count: videos.length,
      source: "YouTube Watch Later sync",
      syncedAt,
      live: true,
      partial,
      videos,
    },
    stats: {
      upserted: seen.size,
      dropped,
      total: videos.length,
      partial,
      resetDropped,
      clearedDropped,
      statedCount: Number.isFinite(statedCount) && statedCount > 0 ? statedCount : null,
    },
  };
}
