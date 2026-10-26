// "Mark done" overrides. Done normally comes from watch progress (100% watched),
// and every extension sync overwrites progress, so an explicit Done lives in its
// own private blob (watch-later/done.json) that a sync never writes.

import { isVideoId } from "./queue.mjs";

export const MAX_DONE = 5000;

export function emptyDone() {
  return { version: 1, updatedAt: null, items: [] };
}

export function normalizeDone(raw) {
  const out = emptyDone();
  if (!raw || typeof raw !== "object") return out;
  out.updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : null;
  const seen = new Set();
  const list = Array.isArray(raw.items) ? raw.items : [];
  for (const item of list) {
    const id = typeof item === "string" ? item : item?.id;
    if (!isVideoId(id) || seen.has(id)) continue;
    seen.add(id);
    out.items.push({ id, doneAt: typeof item?.doneAt === "string" ? item.doneAt : null });
    if (out.items.length >= MAX_DONE) break;
  }
  return out;
}

export function doneIds(done) {
  return done.items.map((item) => item.id);
}

/** ops: done | undone. Pure, used by the API and for optimistic UI. */
export function applyDoneOp(doneIn, op, now = new Date().toISOString()) {
  const done = normalizeDone(doneIn);
  if (!op || !isVideoId(op.id)) return done;
  const has = done.items.some((item) => item.id === op.id);
  if (op.type === "done") {
    if (has || done.items.length >= MAX_DONE) return done;
    return { version: 1, updatedAt: now, items: [...done.items, { id: op.id, doneAt: now }] };
  }
  if (op.type === "undone") {
    if (!has) return done;
    return {
      version: 1,
      updatedAt: now,
      items: done.items.filter((item) => item.id !== op.id),
    };
  }
  return done;
}

/** Videos with explicit Done applied: nothing left to watch, flagged markedDone. */
export function applyDoneOverrides(videos, doneIn) {
  const ids = new Set(doneIds(normalizeDone(doneIn)));
  if (ids.size === 0 || !Array.isArray(videos)) return videos;
  return videos.map((video) =>
    video && ids.has(video.id)
      ? { ...video, watchedPct: 100, remainingSec: 0, markedDone: true }
      : video,
  );
}
