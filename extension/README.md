# Watch Later Sync (Chrome MV3)

Unpacked Chrome extension that scrapes `youtube.com/playlist?list=WL` while you are logged into YouTube, then POSTs progress to this project's `/api/sync`.

The Google Sheet is **seed only**. This extension is the live write path. Opening a video in the library does **not** mark it watched.

## Load unpacked

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `extension/` folder in this repo (the folder that contains `manifest.json`)

You can also unzip `extension/watch-later-sync.zip` and load that folder the same way.

## First-time setup

1. In Vercel → Storage, create a **Blob** store for this project (Hobby is enough). That injects `BLOB_READ_WRITE_TOKEN`.
2. In Vercel → Settings → Environment Variables, add `SYNC_SECRET` (any long random string) for Production and Preview.
3. Redeploy so the API can see both values.
4. Open the extension popup:
   - **Library URL**: `https://youtube-watch-later.vercel.app` (or a preview URL)
   - **Sync secret**: the same `SYNC_SECRET`

## Sync

1. Stay signed into YouTube in Chrome
2. Click **Sync Watch Later**
3. The extension opens or focuses the Watch Later playlist, reads the WL playlist contents (not a generic tree-walk), follows Innertube continuations past the first ~100 videos (`continuationItemRenderer`, `commandExecutorCommand`, and `continuationItemViewModel` tokens; `playlistVideoRenderer` and `lockupViewModel` items), and records playlist order, progress bars, and published dates, then upserts by video id
4. If Innertube still looks truncated (about one page, or under 80% of the previously known on-list size / playlist header count), it automatically falls back to scrolling the DOM and keeps whichever scrape has more unique videos
5. Refresh the site. Videos gone from Watch Later keep their last snapshot and appear under **Dropped** (not in the last full YouTube WL scrape). A truncated scrape does not mass-drop the rest of the library.

## Verify a full scrape (v1.2.1)

1. `chrome://extensions` → reload the unpacked `extension/` folder, or unzip `extension/watch-later-sync.zip` and load that folder
2. Stay signed into YouTube, then click **Sync Watch Later** once on `https://www.youtube.com/playlist?list=WL`
3. Refresh the library. Expect `partial: false` on `/api/library`, no “Sync incomplete” banner, and a scraped count near the full Watch Later size (not stuck at ~100 with `savedRank` only on the first page)
