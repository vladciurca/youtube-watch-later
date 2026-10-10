export const WATCH_STATUSES = [
  "Almost finished",
  "Partially watched",
  "Barely started",
  "Not started",
] as const;

export type WatchStatus = (typeof WATCH_STATUSES)[number];

export type VideoCategory =
  | "tech"
  | "health"
  | "dating"
  | "trailers"
  | "travel"
  | "other";

export const VIDEO_CATEGORIES = [
  "tech",
  "health",
  "dating",
  "trailers",
  "travel",
  "other",
] as const;

export type SortKey =
  | "saved"
  | "remaining"
  | "published"
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
  /** Primary topic. `tech` stays aligned with sheet `techBusiness: true`. */
  category?: VideoCategory;
  t: number;
  url: string;
  remainingSec: number;
  droppedAt: string | null;
  /** 0 = top of YouTube Watch Later. Absent only on the unsynced seed. */
  savedRank?: number | null;
  /** ISO timestamp parsed from YouTube's relative published string at scrape time. */
  publishedAt?: string | null;
  /** Original YouTube relative string, e.g. "4 weeks ago". */
  publishedLabel?: string | null;
}

export interface VideoLibrary {
  count: number;
  source: string;
  videos: Video[];
  syncedAt?: string | null;
  live?: boolean;
  /** True when a truncated scrape was merged without mass-dropping missing videos. */
  partial?: boolean;
}

export interface LibraryFilters {
  statuses: WatchStatus[];
  includeDropped: boolean;
  categories: VideoCategory[];
  query: string;
  sort: SortKey;
}
