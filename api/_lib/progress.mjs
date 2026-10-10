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

export function formatRemaining(seconds) {
  const sec = Math.max(0, Math.round(Number(seconds) || 0));
  if (sec === 0) return "Done";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m left` : `${h}h left`;
  return `${m}:${String(s).padStart(2, "0")} left`;
}

const RELATIVE_DATE_RE =
  /(?:(?:streamed|premiered)\s+)?(\d+)\s*(months?|weeks?|days?|hours?|minutes?|seconds?|years?|mos|mo|wks?|hrs?|mins?|secs?|yrs?|[dhsmyw])\s+ago/i;

function normalizeRelativeUnit(unit) {
  const u = String(unit || "").toLowerCase();
  if (u === "mo" || u === "mos" || u.startsWith("month")) return "month";
  if (u === "m" || u.startsWith("min")) return "minute";
  if (u === "y" || u.startsWith("yr") || u.startsWith("year")) return "year";
  if (u === "w" || u.startsWith("wk") || u.startsWith("week")) return "week";
  if (u === "d" || u.startsWith("day")) return "day";
  if (u === "h" || u.startsWith("hr") || u.startsWith("hour")) return "hour";
  if (u === "s" || u.startsWith("sec") || u.startsWith("second")) return "second";
  return null;
}

const UNIT_MS = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
  year: 365 * 86_400_000,
};

export function extractRelativePublished(text) {
  if (typeof text !== "string") return "";
  const match = text.match(RELATIVE_DATE_RE);
  return match ? match[0].trim() : "";
}

export function parsePublishedRelative(text, now = Date.now()) {
  if (typeof text !== "string") return null;
  const cleaned = text.trim();
  if (!cleaned) return null;
  if (/^just now$/i.test(cleaned)) return new Date(now).toISOString();
  const match = cleaned.match(RELATIVE_DATE_RE);
  if (!match) return null;
    const n = Number(match[1]);
    const unit = normalizeRelativeUnit(match[2]);
    const ms = unit ? UNIT_MS[unit] : 0;
  if (!Number.isFinite(n) || n < 0 || !ms) return null;
  return new Date(now - n * ms).toISOString();
}

export function savedRankFromScraped(raw, fallbackIndex) {
  if (raw?.savedRank != null && raw.savedRank !== "") {
    const rank = Number(raw.savedRank);
    if (Number.isFinite(rank) && rank >= 0) return Math.round(rank);
  }
  if (raw?.index != null && raw.index !== "") {
    const index = Number(raw.index);
    if (Number.isFinite(index) && index >= 1) return Math.round(index) - 1;
  }
  return fallbackIndex;
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
  const publishedLabel =
    (typeof raw.publishedLabel === "string" && raw.publishedLabel.trim()) ||
    (typeof raw.publishedTimeText === "string" && raw.publishedTimeText.trim()) ||
    extractRelativePublished(raw.publishedText) ||
    "";
  const publishedAt =
    (typeof raw.publishedAt === "string" && !Number.isNaN(Date.parse(raw.publishedAt))
      ? new Date(raw.publishedAt).toISOString()
      : null) || parsePublishedRelative(publishedLabel);
  const savedRank = savedRankFromScraped(raw, null);
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
    savedRank,
    index: Number.isFinite(Number(raw.index)) ? Number(raw.index) : undefined,
    publishedAt,
    publishedLabel: publishedLabel || null,
  };
}
