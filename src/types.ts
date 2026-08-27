export const WATCH_STATUSES = [
  "Almost finished",
  "Partially watched",
  "Barely started",
  "Not started",
] as const;

export type WatchStatus = (typeof WATCH_STATUSES)[number];

export type SortKey =
  | "remaining"
  | "watchedPct"
  | "duration"
  | "title"
  | "author";

export interface Video {
  id: string;
  title: string;
  author: string;
  duration: string;
  durationSec: number;
  watchedPct: number;
  status: WatchStatus;
  techBusiness: boolean;
  t: number;
  url: string;
  remainingSec: number;
  droppedAt: string | null;
}

export interface VideoLibrary {
  count: number;
  source: string;
  videos: Video[];
  syncedAt?: string | null;
  live?: boolean;
}

export interface LibraryFilters {
  statuses: WatchStatus[];
  includeDropped: boolean;
  techBusinessOnly: boolean;
  query: string;
  sort: SortKey;
}
