# YouTube Watch Later

A local library for **Vlad Ciurca**'s YouTube Watch Later queue. Filter by watch status and category, sort, search, and click to resume on YouTube.

GitHub is the source of truth. Vercel auto-deploys from `main`.

## Live progress (v1)

YouTube's API does not expose Watch Later or watch percent. The live path is:

1. Logged-in Chrome extension scrapes `youtube.com/playlist?list=WL`
2. POST upserts into **this** project's store by YouTube video id
3. The Vercel site reads that store

The Google Sheet is **seed only** (`public/data/videos.json`, 2026-08-27, 665 videos + Tech/Business tags). Seed `category` is derived from those sheet tags plus the same title/author classifier the sync path uses. The app never writes progress back to the sheet and never rereads it at runtime.

Opening a video in the library does **not** mark it watched. Progress updates only after you watch on YouTube and run **Sync Watch Later**.

Until the first successful sync, the site shows the committed seed snapshot.

## Chrome extension

See [extension/README.md](extension/README.md) for Load unpacked steps.

Short version:

1. `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/`
2. Set the sync secret (same as Vercel `SYNC_SECRET`)
3. Click **Sync Watch Later**
4. Refresh the site

Videos that disappear from Watch Later keep their last snapshot and get `droppedAt`. The **Dropped** filter then lists them. That means **not in the last full YouTube WL scrape**, not that you marked the video dropped.

If the playlist header states a video count, a scrape is complete only when it collected at least 98% of that count. Otherwise, when the header count is missing, a scrape is treated as truncated if it has fewer than 80% of the previous on-list library and that library has at least 50 videos. A truncated scrape does **not** mark missing videos Dropped. The library is stored with `partial: true` and the UI shows **sync incomplete**. A later full scrape still drops videos that are actually gone.

The first live scrape only read YouTube's first page (~100 videos) and stamped `droppedAt` on the rest of the seeded library. A later ~100-video sync is not treated as partial once only those 100 remain on-list, so the false stamps stuck. The updated extension sends `{ resetDropped: true }` **once** on the next sync (reload unpacked, then Sync Watch Later). That clears current Dropped stamps, then merge runs as usual: videos in the scrape stay on-list; a full scrape re-drops videos that are actually gone; a partial scrape does not mass-drop the restored ones.

Extension 1.5.0 syncs automatically once a day while the browser is open; 1.5.1 reloads a reused Watch Later tab before scraping it (an open or sleeping tab served stale page data, so newly added videos were missed), stops an incomplete scrape from counting as the day's sync, and makes the popup say when the next sync is due and why a check was skipped (see `extension/README.md`); 1.4.0 added a manual **Sync Done to YouTube** button (see `extension/README.md` and `extension/CHANGELOG.md`). The 1.3.0 scrape follows the current Watch Later Innertube page: `lockupViewModel` rows, the continuation token that sits in the video list (not the empty sibling token), `browse` or `next` from the command's `apiUrl`, and a `SAPISIDHASH` header from the `SAPISID` cookie. It keeps requesting pages until the token runs out, capped at 5,000 videos. If that result is still under 98% of the header count (for example `1,234 videos`), it scrolls the playlist DOM until the row count stops growing. Reload unpacked (or install `extension/watch-later-sync.zip`) and Sync once.

`savedRank` is the scraped playlist order (0 = top of Watch Later), not a per-row index and not publish date or time remaining. A partial scrape keeps videos it missed after the scraped ones, in their previous relative order. Dropped videos sort last under **Saved**.

New Watch Later videos get a `category` at sync time from title + channel: majority category channels already in the library, plus keywords. Categories:

| `category` | Label | Heuristics |
| --- | --- | --- |
| `tech` | Tech / Business | Sheet `techBusiness: true` is never overwritten. Else YC/SaaS/AI/VC/investing and majority-tech channels |
| `health` | Health / longevity | Bryan Johnson, Attia, Huberman, sauna, sleep, workouts, posture, diet |
| `dating` | Dating / relationships | Divorce, attraction, masculinity, Naval on love, Orion Taraban |
| `trailers` | Trailers | Apple TV, official trailer, teaser, movie/TV promos |
| `travel` | Travel / packing | Pack Hacker, backpacks, hotels, packing lists |
| `other` | Other | Default when unsure |

If a video already has `techBusiness: true` from the sheet or previous library, category stays `tech`. The Google Sheet is never reread.

Each row shows the YouTube published date (`publishedTimeText` / "4 weeks ago"), parsed to ISO at scrape time. **Published** sorts newest first; videos without a date sort last. Later scrapes that omit a date keep the previous `publishedAt`.

Status is recomputed from watched percent (`statusFromWatchedPct` in `api/_lib/progress.mjs`; the browser re-derives it on load so older stored statuses follow the same rules):

| Watched % | Status |
| --- | --- |
| 95+ | Done |
| 90–94 | Almost finished |
| 40–89 | Partially watched |
| 10–39 | Barely started |
| 0–9 | Not started |

**Done** is one shared threshold, `DONE_THRESHOLD_PCT = 95` in `api/_lib/threshold.mjs`, used by the UI (`isDone`), the Queue auto-removal (`isDoneVideo`), the "Done" label and the locked check. It depends only on watch progress, not on whether the video is still in the playlist. A missing or null `watchedPct` is never Done, and an unknown duration (0s) no longer makes a video Done. Marking done by hand (`done.json`) still works below 95% and survives syncs.

`remainingSec = durationSec * (1 - watchedPct / 100)`. Resume `t` comes from playlist progress.

## Vercel env (Hobby)

Create a **Blob** store on the project (Storage → Blob). Private stores work: `/api/sync` writes with `access: "private"` and `/api/library` reads with `@vercel/blob` `get(pathname)` (v2 returns `null` on 404; `useCache: false` bypasses CDN). If `get` is unavailable, it falls back to `list` plus a `BLOB_READ_WRITE_TOKEN` bearer request, never a public fetch.

Then set:

- `SYNC_SECRET` — required on `POST /api/sync` via `X-Sync-Secret`
- `BLOB_READ_WRITE_TOKEN` — added automatically by the Blob store

No new paid database. Seed JSON stays the public fallback.

## Local run

```bash
npm install
npm test
npm run dev
```

Dev server: [http://127.0.0.1:43141](http://127.0.0.1:43141)

```bash
npm run build
npm run preview
```

`/api/*` is served on Vercel. Locally the UI falls back to `public/data/videos.json`.

## Default view

- No filters: every video shows on load, including Done and Dropped. Status and category chips start unselected (single-select chips; click one to filter, click the selected chip to show all again). The search box starts empty and the Dropped toggle starts off, which does not hide dropped videos while no status is selected.
- Sort: **Saved** — YouTube Watch Later order (`savedRank` 0 is the top of the list). Until the first sync, the seed has no rank and **Saved** keeps the seed's order. **Remaining** sorts least leftover time among unfinished videos first, Done / 100% last. Leftover under an hour shows `M:SS` (e.g. `6:00 left`); hours stay `1h 4m left`. **Published** sorts newest upload first, missing dates last. **Watched %** still sorts highest `watchedPct` first

Click a row to open `https://www.youtube.com/watch?v={id}&t={t}s` in a new tab. That click does not change `watchedPct` or `status`.

## Queue

A star on every row adds or removes a video from the **Queue**. The **Queue** tab (with a count) shows only queued videos in queue order; the app still opens on **All** with no filters. Reorder by dragging the handle (works by touch), or use the move-to-top / up / down buttons. Filters and sort do not apply inside the Queue.

- Stored server-side in its own private Blob, `watch-later/queue.json`, via `/api/queue` (GET list, POST `{ op }` with `add | remove | top | up | down | reorder`). Phone and laptop read the same list; each re-reads it when the tab is focused or Refresh is pressed. **No database migration is needed.**
- The extension sync rewrites only `watch-later/library.json`. It never writes queue data, and a video that becomes Dropped stays queued. After a sync the only change is that videos now **Done** (nothing left to watch) leave the Queue; the Queue API does the same when it is read. Tapping the star again also removes a video.
- **Mark done:** each row (and each Queue row) has a check button. It stores an explicit Done in its own private Blob, `watch-later/done.json`, via `/api/done` (POST `{ op: { type: "done" | "undone", id } }`), which a sync never writes, so it survives syncs even if YouTube progress is lower. Marking done also removes the video from the Queue; the check button on a marked row is "Mark not done" (undo). Videos already at 100% on YouTube show a locked check.
- Reordering on touch uses native non-passive touch listeners on the drag handle only (iOS Safari needs this to stop the page scrolling); mouse uses pointer events. Move-to-top / up / down buttons are 44px on phones.
- The Queue never touches YouTube's real Watch Later playlist.
- If the Queue API cannot be reached (e.g. no `BLOB_READ_WRITE_TOKEN`), stars are disabled and the tab says the Queue is unavailable; the rest of the library works as before.

## Out of scope

Backend scrapes that use your YouTube cookies, sheet writes, Origin mirroring, and public-library auth. The write API is secret-header protected; the library itself stays public.
