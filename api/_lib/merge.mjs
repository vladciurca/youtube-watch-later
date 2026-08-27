import {
  formatDuration,
  normalizeScrapedVideo,
  remainingSecFrom,
  resumeTimeFrom,
  statusFromWatchedPct,
} from "./progress.mjs";

export function mergeWatchLaterLibrary(existingVideos, scrapedVideos, syncedAt) {
  const previous = new Map();
  for (const video of existingVideos) {
    if (video?.id) previous.set(video.id, video);
  }

  const seen = new Set();
  const videos = [];

  for (const raw of scrapedVideos) {
    const scraped = normalizeScrapedVideo(raw);
    if (!scraped || seen.has(scraped.id)) continue;
    seen.add(scraped.id);
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

    videos.push({
      id: scraped.id,
      title,
      author,
      duration,
      durationSec,
      watchedPct,
      status: statusFromWatchedPct(watchedPct),
      techBusiness: prev?.techBusiness === true,
      t: resumeTimeFrom(durationSec, watchedPct, scraped.t),
      url: `https://www.youtube.com/watch?v=${scraped.id}`,
      remainingSec: remainingSecFrom(durationSec, watchedPct),
      droppedAt: null,
      savedRank,
    });
  }

  let dropped = 0;
  for (const prev of existingVideos) {
    if (!prev?.id || seen.has(prev.id)) continue;
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
      videos,
    },
    stats: {
      upserted: seen.size,
      dropped,
      total: videos.length,
    },
  };
}
