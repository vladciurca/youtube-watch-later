export const WATCH_STATUSES = [
  "Almost finished",
  "Partially watched",
  "Barely started",
  "Not started",
];

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function isVideoId(id) {
  return typeof id === "string" && VIDEO_ID_RE.test(id);
}

export function clampWatchedPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

export function statusFromWatchedPct(watchedPct) {
  const pct = clampWatchedPct(watchedPct);
  if (pct >= 90) return "Almost finished";
  if (pct >= 40) return "Partially watched";
  if (pct >= 10) return "Barely started";
  return "Not started";
}

export function parseDuration(text) {
  if (typeof text !== "string") return 0;
  const parts = text
    .trim()
    .split(":")
    .map((part) => Number(part));
  if (parts.length === 0 || parts.some((part) => !Number.isFinite(part))) {
    return 0;
  }
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

export function formatDuration(seconds) {
  const sec = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function remainingSecFrom(durationSec, watchedPct) {
  return durationSec * (1 - clampWatchedPct(watchedPct) / 100);
}

export function resumeTimeFrom(durationSec, watchedPct, hintedT) {
  const pct = clampWatchedPct(watchedPct);
  if (pct >= 100) return 0;
  const hinted = Number(hintedT);
  if (Number.isFinite(hinted) && hinted > 0) {
    return Math.min(Math.round(hinted), Math.max(0, Math.round(durationSec) - 1));
  }
  return Math.round(durationSec * (pct / 100));
}

export function normalizeScrapedVideo(raw) {
  if (!raw || !isVideoId(raw.id)) return null;
  const durationSec =
    Number(raw.durationSec) > 0
      ? Math.round(Number(raw.durationSec))
      : parseDuration(raw.duration);
  const watchedPct = clampWatchedPct(raw.watchedPct);
  return {
    id: raw.id,
    title: typeof raw.title === "string" ? raw.title.trim() : "",
    author: typeof raw.author === "string" ? raw.author.trim() : "",
    duration: typeof raw.duration === "string" && raw.duration.trim()
      ? raw.duration.trim()
      : formatDuration(durationSec),
    durationSec,
    watchedPct,
    t: raw.t,
  };
}
