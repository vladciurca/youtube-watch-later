# Changelog

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
