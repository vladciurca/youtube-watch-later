# YouTube Watch Later

A local library for **Vlad Ciurca**'s YouTube Watch Later queue. Browse 665 saved videos the way you browse X likes: filter by watch status and Tech/Business, sort, search, and click to resume on YouTube.

This is **v0**. The app reads a committed snapshot. There is no live YouTube scrape, no sheet writes, and clicking a video does **not** mark it watched.

## Data snapshot

Vendored at `public/data/videos.json`.

- Source: **Vlad Youtube watchlater sheet 2026-08-27**
- 665 unique videos
- Runtime never fetches the original export URL; the committed file is the source of truth

To refresh later, replace `public/data/videos.json` with a new export of the same shape.

## Local run

```bash
npm install
npm run dev
```

Dev server: [http://127.0.0.1:43141](http://127.0.0.1:43141)

```bash
npm run build
npm run preview
```

## Default view

- Status: **Almost finished** only
- Topic: **Tech / Business** on
- Sort: **Remaining** (least remaining first)

Click a row to open `https://www.youtube.com/watch?v={id}&t={t}s` in a new tab. Opening a video does not change `watchedPct` or `status`.

## Out of scope (v0)

Live scrape, Google Sheet writes, auth, and marking videos watched on click.
