// Queue = an ordered list of video ids Vlad wants to watch next.
// It lives in its own private blob (watch-later/queue.json), never inside the
// library blob, so the extension sync (which rewrites the library) cannot wipe
// it. It never touches YouTube's real Watch Later playlist.

export const MAX_QUEUE = 500;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function isVideoId(value) {
  return typeof value === "string" && VIDEO_ID.test(value);
}

export function emptyQueue() {
  return { version: 1, updatedAt: null, items: [] };
}

/** Accepts whatever came out of storage and returns a clean queue. */
export function normalizeQueue(raw) {
  const out = emptyQueue();
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
      queuedAt: typeof item?.queuedAt === "string" ? item.queuedAt : null,
    });
    if (out.items.length >= MAX_QUEUE) break;
  }
  return out;
}

export function queueIds(queue) {
  return queue.items.map((item) => item.id);
}

function withItems(queue, items, now) {
  return { version: 1, updatedAt: now ?? queue.updatedAt, items };
}

function moveItem(items, from, to) {
  const next = items.slice();
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}

/**
 * Pure queue update, used by the API and by the browser for optimistic UI.
 * ops: add | remove | top | up | down | reorder (ids = full desired order).
 * Unknown ids and no-ops return the queue unchanged.
 */
export function applyQueueOp(queueIn, op, now = new Date().toISOString()) {
  const queue = normalizeQueue(queueIn);
  if (!op || typeof op !== "object") return queue;
  const { items } = queue;
  const index = isVideoId(op.id) ? items.findIndex((item) => item.id === op.id) : -1;

  switch (op.type) {
    case "add": {
      if (!isVideoId(op.id) || index !== -1 || items.length >= MAX_QUEUE) return queue;
      return withItems(queue, [...items, { id: op.id, queuedAt: now }], now);
    }
    case "remove": {
      if (index === -1) return queue;
      return withItems(queue, items.filter((item) => item.id !== op.id), now);
    }
    case "top": {
      if (index <= 0) return queue;
      return withItems(queue, moveItem(items, index, 0), now);
    }
    case "up": {
      if (index <= 0) return queue;
      return withItems(queue, moveItem(items, index, index - 1), now);
    }
    case "down": {
      if (index === -1 || index >= items.length - 1) return queue;
      return withItems(queue, moveItem(items, index, index + 1), now);
    }
    case "reorder": {
      if (!Array.isArray(op.ids)) return queue;
      const byId = new Map(items.map((item) => [item.id, item]));
      const ordered = [];
      const used = new Set();
      for (const id of op.ids) {
        const item = byId.get(id);
        if (!item || used.has(id)) continue;
        used.add(id);
        ordered.push(item);
      }
      // Anything the sender did not know about (e.g. added on another device
      // a moment ago) stays, at the end, instead of being dropped.
      for (const item of items) if (!used.has(item.id)) ordered.push(item);
      const same = ordered.every((item, i) => item.id === items[i].id);
      return same ? queue : withItems(queue, ordered, now);
    }
    default:
      return queue;
  }
}

export function isDoneVideo(video) {
  return Number.isFinite(video?.remainingSec) && video.remainingSec <= 0;
}

/**
 * Drop queued videos that are Done (nothing left to watch). Videos that are
 * Dropped, missing from the library, or unknown are never removed here.
 */
export function pruneDoneFromQueue(queueIn, videos, now = new Date().toISOString()) {
  const queue = normalizeQueue(queueIn);
  if (!Array.isArray(videos) || queue.items.length === 0) {
    return { queue, removed: [] };
  }
  const done = new Set();
  for (const video of videos) {
    if (video?.id && isDoneVideo(video)) done.add(video.id);
  }
  const removed = queue.items.filter((item) => done.has(item.id)).map((i) => i.id);
  if (removed.length === 0) return { queue, removed };
  return {
    queue: withItems(
      queue,
      queue.items.filter((item) => !done.has(item.id)),
      now,
    ),
    removed,
  };
}
