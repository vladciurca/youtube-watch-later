# Changelog

## 1.5.1

- A reused Watch Later tab is now reloaded before it is scraped. A tab left open (or put to sleep by Arc) still held the page data from whenever it loaded, so videos added to Watch Later since then were invisible to both the automatic and the manual sync.
- Waiting for the playlist to load no longer misses a load that finished first, and no longer waits 45 s on a sleeping tab: the tab's current state is checked as well as the load event. This could fail every unattended run with "Timed out waiting for Watch Later to load".
- An incomplete scrape no longer counts as a completed daily sync, so the next run is 2 h away instead of 20 h (capped: after 3 incomplete runs in a row it waits the full interval again).
- The popup now says when the next sync is due and why the last check did not run one (fresh, backoff, disabled, no secret, already running), plus the time of the last full sync and the last attempt. Skipped hourly checks are recorded (`lastCheckAt`, `lastSkipReason`) so a quiet extension can be diagnosed.

## 1.5.0

- Automatic daily sync while the browser is open: hourly alarm plus a startup catch-up when the last successful run is more than ~20 h old. Runs the normal scrape + upload in an inactive tab.
- Optional (off by default) unattended Done step, capped at 5 videos per run. Never removes anything from Watch Later.
- Popup: **Auto-sync daily** toggle (default on), **Run now**, last run time and result.
- Failures back off (2 h, then 20 h after 3 in a row) and never loop. New permission: `alarms`. New file: `auto-sync.js`.

## 1.4.0

- New manual **Sync Done to YouTube** button in the popup. Shows the count, asks for confirmation, then marks Done videos as watched one at a time by seeking the player near the end in a small muted window. Progress, Cancel, per-video timeout, ad skipping, and skip/fail reporting for live, private, unavailable and age-restricted videos.
- Synced and skipped IDs are remembered in `chrome.storage.local`. No new permissions.
- New files: `done-sync.js` (pure selection/job logic), `mark-watched.js` (in-page player runner).

## 1.3.0

- Watch Later scrape follows the current Innertube `lockupViewModel` shape, pagination token, and DOM fallback.
