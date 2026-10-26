// Single source of truth for "Done". A video counts as Done once it is watched
// at least this far, whether or not it is still in the YouTube playlist.
export const DONE_THRESHOLD_PCT = 95;

/** True when `pct` is a real number >= the threshold. null/undefined/NaN are not Done. */
export function isDonePct(pct) {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return false;
  return pct >= DONE_THRESHOLD_PCT;
}

/** Done from watch progress. A missing or null watchedPct is never Done. */
export function isDoneVideo(video) {
  return isDonePct(video?.watchedPct);
}
