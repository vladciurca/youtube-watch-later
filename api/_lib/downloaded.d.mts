export interface DownloadedItem {
  id: string;
  downloadedAt: string | null;
}
export interface DownloadedList {
  version: number;
  updatedAt: string | null;
  items: DownloadedItem[];
}
export type DownloadedOp = { type: "downloaded" | "undownloaded"; id: string };

export const MAX_DOWNLOADED: number;
export function emptyDownloaded(): DownloadedList;
export function normalizeDownloaded(raw: unknown): DownloadedList;
export function downloadedIds(list: DownloadedList): string[];
export function applyDownloadedOp(
  list: unknown,
  op: DownloadedOp,
  now?: string,
): DownloadedList;
export function applyDownloadedMarks<T extends { id?: string; downloaded?: boolean }>(
  videos: T[],
  list: unknown,
): T[];
export function pruneDoneFromDownloaded(
  list: unknown,
  videos: Array<{ id?: string; watchedPct?: number }>,
  now?: string,
): { list: DownloadedList; removed: string[] };
