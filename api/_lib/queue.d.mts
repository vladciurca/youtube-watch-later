export interface QueueItem {
  id: string;
  queuedAt: string | null;
}
export interface Queue {
  version: number;
  updatedAt: string | null;
  items: QueueItem[];
}
export type QueueOp =
  | { type: "add" | "remove" | "top" | "up" | "down"; id: string }
  | { type: "reorder"; ids: string[] };

export const MAX_QUEUE: number;
export function isVideoId(value: unknown): value is string;
export function emptyQueue(): Queue;
export function normalizeQueue(raw: unknown): Queue;
export function queueIds(queue: Queue): string[];
export function applyQueueOp(queue: unknown, op: QueueOp, now?: string): Queue;
export function isDoneVideo(video: { remainingSec?: number } | null | undefined): boolean;
export function pruneDoneFromQueue(
  queue: unknown,
  videos: { id?: string; remainingSec?: number }[],
  now?: string,
): { queue: Queue; removed: string[] };
