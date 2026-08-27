import type { LibraryFilters, SortKey, Video, WatchStatus } from "../types";
import { WATCH_STATUSES } from "../types";

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "saved", label: "Saved" },
  { key: "remaining", label: "Remaining" },
  { key: "published", label: "Published" },
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
  sort: "saved",
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
  const s = sec % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m left` : `${h}h left`;
  return `${m}:${String(s).padStart(2, "0")} left`;
}

export function publishedDisplay(video: Pick<Video, "publishedLabel" | "publishedAt">): string {
  if (video.publishedLabel) return video.publishedLabel;
  if (!video.publishedAt) return "";
  const date = new Date(video.publishedAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
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

function hasSavedRank(video: Video): boolean {
  return Number.isFinite(video.savedRank);
}

function compareRemaining(a: Video, b: Video): number {
  const aDone = isDone(a);
  const bDone = isDone(b);
  if (aDone !== bDone) return aDone ? 1 : -1;
  return a.remainingSec - b.remainingSec || a.title.localeCompare(b.title);
}

function compareSaved(a: Video, b: Video): number {
  const aRanked = hasSavedRank(a);
  const bRanked = hasSavedRank(b);
  if (!aRanked && !bRanked) return compareRemaining(a, b);

  const aDropped = a.droppedAt != null;
  const bDropped = b.droppedAt != null;
  if (aDropped !== bDropped) return aDropped ? 1 : -1;

  if (aRanked !== bRanked) return aRanked ? -1 : 1;
  return (a.savedRank as number) - (b.savedRank as number) || a.title.localeCompare(b.title);
}

function comparePublished(a: Video, b: Video): number {
  const aTime = Date.parse(a.publishedAt || "");
  const bTime = Date.parse(b.publishedAt || "");
  const aOk = Number.isFinite(aTime);
  const bOk = Number.isFinite(bTime);
  if (aOk !== bOk) return aOk ? -1 : 1;
  if (!aOk && !bOk) return a.title.localeCompare(b.title);
  return bTime - aTime || a.title.localeCompare(b.title);
}

function compareVideos(a: Video, b: Video, sort: SortKey): number {
  switch (sort) {
    case "saved":
      return compareSaved(a, b);
    case "remaining":
      return compareRemaining(a, b);
    case "published":
      return comparePublished(a, b);
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
