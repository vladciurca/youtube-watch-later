// Manual "Downloaded" marks. YouTube does not expose Premium downloads, so
// Vlad taps this after downloading a video in the YouTube app. The list lives
// in its own private blob (watch-later/downloaded.json) that a sync never
// writes. A video that becomes Done (95%+ watched, or explicitly marked)
// is cleared automatically.

import { isVideoId } from "./queue.mjs";
import { isDoneVideo } from "./threshold.mjs";

export const MAX_DOWNLOADED = 5000;

export function emptyDownloaded() {
  return { version: 1, updatedAt: null, items: [] };
}

export function normalizeDownloaded(raw) {
  const out = emptyDownloaded();
  if (!raw || typeof raw !== "object") return out;
  out.updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : null;
  const seen = new Set();
  const list = Array.isArray(raw.items) ? raw.items : [];
  for (const item of list) {
    const id = typeof item === "string" ? item : item?.id;
    if (!isVideoId(id) || seen.has(id)) continue;
    seen.add(id);
    out.items.push({
      id,
      downloadedAt: typeof item?.downloadedAt === "string" ? item.downloadedAt : null,
    });
    if (out.items.length >= MAX_DOWNLOADED) break;
  }
  return out;
}

export function downloadedIds(list) {
  return list.items.map((item) => item.id);
}

/** ops: downloaded | undownloaded. Pure, used by the API and for optimistic UI. */
export function applyDownloadedOp(listIn, op, now = new Date().toISOString()) {
  const list = normalizeDownloaded(listIn);
  if (!op || !isVideoId(op.id)) return list;
  const has = list.items.some((item) => item.id === op.id);
  if (op.type === "downloaded") {
    if (has || list.items.length >= MAX_DOWNLOADED) return list;
    return {
      version: 1,
      updatedAt: now,
      items: [...list.items, { id: op.id, downloadedAt: now }],
    };
  }
  if (op.type === "undownloaded") {
    if (!has) return list;
    return {
      version: 1,
      updatedAt: now,
      items: list.items.filter((item) => item.id !== op.id),
    };
  }
  return list;
}

/**
 * Flag videos that are marked Downloaded. Done videos never keep the flag,
 * even if a stale id is still in the list (the API also prunes them).
 */
export function applyDownloadedMarks(videos, listIn) {
  const list = normalizeDownloaded(listIn);
  const byId = new Map(list.items.map((item) => [item.id, item]));
  if (byId.size === 0 || !Array.isArray(videos)) return videos;
  return videos.map((video) => {
    if (!video) return video;
    const item = byId.get(video.id);
    if (!item || isDoneVideo(video)) {
      return video.downloaded ? { ...video, downloaded: false, downloadedAt: null } : video;
    }
    return { ...video, downloaded: true, downloadedAt: item.downloadedAt ?? null };
  });
}

/** Drop downloaded marks on videos that are now Done (progress or override). */
export function pruneDoneFromDownloaded(listIn, videos, now = new Date().toISOString()) {
  const list = normalizeDownloaded(listIn);
  if (!Array.isArray(videos) || list.items.length === 0) {
    return { list, removed: [] };
  }
  const done = new Set();
  for (const video of videos) {
    if (video?.id && isDoneVideo(video)) done.add(video.id);
  }
  const removed = list.items.filter((item) => done.has(item.id)).map((item) => item.id);
  if (removed.length === 0) return { list, removed };
  return {
    list: {
      version: 1,
      updatedAt: now,
      items: list.items.filter((item) => !done.has(item.id)),
    },
    removed,
  };
}
