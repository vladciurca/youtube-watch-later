import { applyQueueOp, emptyQueue, normalizeQueue, queueIds } from "../../api/_lib/queue.mjs";
import type { Queue, QueueOp } from "../../api/_lib/queue.mjs";
import type { Video } from "../types";
import { isDoneVideo } from "../../api/_lib/threshold.mjs";

export type { Queue, QueueOp };
export { applyQueueOp, emptyQueue, normalizeQueue, queueIds };

export function isDone(video: Pick<Video, "watchedPct">): boolean {
  return isDoneVideo(video);
}

/** Queued videos, in queue order. Ids the library does not know are skipped. */
export function queuedVideos(videos: Video[], ids: string[]): Video[] {
  const byId = new Map(videos.map((video) => [video.id, video]));
  const out: Video[] = [];
  for (const id of ids) {
    const video = byId.get(id);
    if (video && !isDone(video)) out.push(video);
  }
  return out;
}

/** New full order after moving `id` so it lands at `insertIndex` among the others. */
export function reorderIds(ids: string[], id: string, insertIndex: number): string[] {
  const rest = ids.filter((item) => item !== id);
  if (rest.length === ids.length) return ids;
  const at = Math.max(0, Math.min(rest.length, insertIndex));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

export async function fetchQueue(): Promise<Queue> {
  const response = await fetch("/api/queue", { cache: "no-store" });
  if (!response.ok) throw new Error(`Queue request failed (${response.status})`);
  return normalizeQueue(await response.json());
}

export async function sendQueueOp(op: QueueOp): Promise<Queue> {
  const response = await fetch("/api/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op }),
  });
  if (!response.ok) {
    let detail = "";
    try {
      detail = ((await response.json()) as { error?: string }).error ?? "";
    } catch {
      // ignore
    }
    throw new Error(detail || `Queue update failed (${response.status})`);
  }
  return normalizeQueue(await response.json());
}
