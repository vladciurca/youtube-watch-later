import {
  majorityChannelsByCategory,
  resolveCategory,
} from "./categorize.mjs";
import {
  formatDuration,
  normalizeScrapedVideo,
  remainingSecFrom,
  resumeTimeFrom,
  savedRankFromScraped,
  statusFromWatchedPct,
} from "./progress.mjs";

const PARTIAL_SYNC_MIN_PREVIOUS = 50;
const PARTIAL_SYNC_RATIO = 0.8;

export function isPartialWatchLaterScrape(existingVideos, scrapedCount) {
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
    const savedRank = savedRankFromScraped(scraped, seen.size - 1);

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

  const partial = isPartialWatchLaterScrape(prepared, seen.size);

  let dropped = 0;
  for (const prev of prepared) {
    if (!prev?.id || seen.has(prev.id)) continue;
    if (partial && prev.droppedAt == null) {
      videos.push({ ...prev });
      continue;
    }
    videos.push({
      ...prev,
      droppedAt: prev.droppedAt ?? syncedAt,
    });
    dropped += 1;
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
    },
  };
}
