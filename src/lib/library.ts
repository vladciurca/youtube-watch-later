import type { LibraryFilters, SortKey, Video, WatchStatus } from "../types";
import { WATCH_STATUSES } from "../types";

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "remaining", label: "Remaining" },
  { key: "watchedPct", label: "Watched %" },
  { key: "duration", label: "Duration" },
  { key: "title", label: "Title" },
  { key: "author", label: "Author" },
];

export const DEFAULT_FILTERS: LibraryFilters = {
  statuses: ["Almost finished"],
  includeDropped: false,
  techBusinessOnly: true,
  query: "",
  sort: "remaining",
};

export function youtubeResumeUrl(video: Video): string {
  return `https://www.youtube.com/watch?v=${video.id}&t=${video.t}s`;
}

export function thumbnailUrl(id: string): string {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

export function formatRemaining(seconds: number): string {
  const sec = Math.max(0, Math.round(seconds));
  if (sec === 0) return "Done";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m left` : `${h}h left`;
  if (m > 0) return `${m}m left`;
  return `${sec}s left`;
}

function matchesQuery(video: Video, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    video.title.toLowerCase().includes(q) ||
    video.author.toLowerCase().includes(q)
  );
}

function matchesTech(video: Video, techBusinessOnly: boolean): boolean {
  return !techBusinessOnly || video.techBusiness;
}

function matchesStatus(
  video: Video,
  statuses: WatchStatus[],
  includeDropped: boolean,
): boolean {
  if (statuses.length === 0 && !includeDropped) return true;
  const statusHit = statuses.includes(video.status);
  const droppedHit = includeDropped && video.droppedAt != null;
  return statusHit || droppedHit;
}

export function statusCounts(
  videos: Video[],
  filters: Pick<LibraryFilters, "techBusinessOnly" | "query">,
): Record<WatchStatus | "Dropped", number> {
  const counts: Record<WatchStatus | "Dropped", number> = {
    "Almost finished": 0,
    "Partially watched": 0,
    "Barely started": 0,
    "Not started": 0,
    Dropped: 0,
  };

  for (const video of videos) {
    if (!matchesTech(video, filters.techBusinessOnly)) continue;
    if (!matchesQuery(video, filters.query)) continue;
    if (WATCH_STATUSES.includes(video.status)) {
      counts[video.status] += 1;
    }
    if (video.droppedAt != null) counts.Dropped += 1;
  }

  return counts;
}

function isDone(video: Video): boolean {
  return video.remainingSec <= 0;
}

function compareVideos(a: Video, b: Video, sort: SortKey): number {
  switch (sort) {
    case "remaining": {
      const aDone = isDone(a);
      const bDone = isDone(b);
      if (aDone !== bDone) return aDone ? 1 : -1;
      return a.remainingSec - b.remainingSec || a.title.localeCompare(b.title);
    }
    case "watchedPct":
      return b.watchedPct - a.watchedPct || a.title.localeCompare(b.title);
    case "duration":
      return b.durationSec - a.durationSec || a.title.localeCompare(b.title);
    case "title":
      return a.title.localeCompare(b.title);
    case "author":
      return a.author.localeCompare(b.author) || a.title.localeCompare(b.title);
  }
}

export function filterAndSortVideos(
  videos: Video[],
  filters: LibraryFilters,
): Video[] {
  return videos
    .filter(
      (video) =>
        matchesStatus(video, filters.statuses, filters.includeDropped) &&
        matchesTech(video, filters.techBusinessOnly) &&
        matchesQuery(video, filters.query),
    )
    .sort((a, b) => compareVideos(a, b, filters.sort));
}
