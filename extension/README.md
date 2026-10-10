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
3. The extension opens or focuses the Watch Later playlist, reads the WL playlist in list order (`playlistVideoRenderer` and `lockupViewModel`), and follows the continuation token that sits in that list. A second sibling token that returns an empty body is ignored. Requests use the WEB client context (`clientVersion` and `visitorData` from `ytcfg`) and a `SAPISIDHASH` header built from the `SAPISID` cookie. Pagination stops when the token runs out, or at 5,000 videos
4. The popup reports `Scraped N of M (stated), method innertube` (or `dom`). `M` is the playlist header count, such as `1,234 videos`. If Innertube is under 98% of that count, the extension scrolls the playlist until the row count stops growing and keeps whichever scrape has more unique videos
5. Refresh the site. `savedRank` matches that scraped order. Videos the scrape missed stay after those, in their previous order. Videos gone from a full Watch Later scrape keep their last snapshot and appear under **Dropped**. A short scrape does not mass-drop the rest of the library

## Verify a full scrape (v1.3.0)

1. `chrome://extensions` → reload the unpacked `extension/` folder, or unzip `extension/watch-later-sync.zip` and load that folder
2. Stay signed into YouTube, then click **Sync Watch Later** once on `https://www.youtube.com/playlist?list=WL`
3. The popup should show a scraped count near the header's video count, and the method used. Refresh the library. Expect `partial: false` on `/api/library` when the scrape reached about 98% of that count, no “Sync incomplete” banner, and **Saved** order matching Watch Later from top to bottom
