# YouTube Watch Later

A local library for **Vlad Ciurca**'s YouTube Watch Later queue. Filter by watch status and Tech/Business, sort, search, and click to resume on YouTube.

GitHub is the source of truth. Vercel auto-deploys from `main`.

## Live progress (v1)

YouTube's API does not expose Watch Later or watch percent. The live path is:

1. Logged-in Chrome extension scrapes `youtube.com/playlist?list=WL`
2. POST upserts into **this** project's store by YouTube video id
3. The Vercel site reads that store

The Google Sheet is **seed only** (`public/data/videos.json`, 2026-08-27, 665 videos + Tech/Business tags). The app never writes progress back to the sheet and never rereads it at runtime.

Opening a video in the library does **not** mark it watched. Progress updates only after you watch on YouTube and run **Sync Watch Later**.

Until the first successful sync, the site shows the committed seed snapshot.

## Chrome extension

See [extension/README.md](extension/README.md) for Load unpacked steps.

Short version:

1. `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/`
2. Set the sync secret (same as Vercel `SYNC_SECRET`)
3. Click **Sync Watch Later**
4. Refresh the site

Videos that disappear from Watch Later keep their last snapshot and get `droppedAt`. The **Dropped** filter then lists them.

New Watch Later videos that were not in the seed land with `techBusiness: false`. Seed tags are preserved on upsert.

Status is recomputed from watched percent:

| Watched % | Status |
| --- | --- |
| 90+ | Almost finished |
| 40–89 | Partially watched |
| 10–39 | Barely started |
| 0–9 | Not started |

`remainingSec = durationSec * (1 - watchedPct / 100)`. Resume `t` comes from playlist progress.

## Vercel env (Hobby)

Create a **Blob** store on the project (Storage → Blob). Private stores work: `/api/sync` writes with `access: "private"` and `/api/library` reads through the Blob SDK (or a `BLOB_READ_WRITE_TOKEN` bearer request), not a public URL.

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

- Status: **Almost finished** only (single-select chips; click another status to switch immediately; click the selected chip to show all)
- Topic: **Tech / Business** on
- Sort: **Remaining** — least leftover time among videos that are not done (`remainingSec > 0`) first; Done / 100% last. **Watched %** still sorts highest `watchedPct` first

Click a row to open `https://www.youtube.com/watch?v={id}&t={t}s` in a new tab. That click does not change `watchedPct` or `status`.

## Out of scope

Backend scrapes that use your YouTube cookies, sheet writes, Origin mirroring, and public-library auth. The write API is secret-header protected; the library itself stays public.
