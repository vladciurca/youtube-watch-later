# Changelog

## 1.4.0

- New manual **Sync Done to YouTube** button in the popup. Shows the count, asks for confirmation, then marks Done videos as watched one at a time by seeking the player near the end in a small muted window. Progress, Cancel, per-video timeout, ad skipping, and skip/fail reporting for live, private, unavailable and age-restricted videos.
- Synced and skipped IDs are remembered in `chrome.storage.local`. No new permissions.
- New files: `done-sync.js` (pure selection/job logic), `mark-watched.js` (in-page player runner).

## 1.3.0

- Watch Later scrape follows the current Innertube `lockupViewModel` shape, pagination token, and DOM fallback.
