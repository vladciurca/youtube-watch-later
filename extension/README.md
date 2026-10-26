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

## Sync Done to YouTube (v1.4.0)

Videos you mark **Done** in the library can be marked watched on YouTube. It is **manual only**: nothing runs on install, on a timer, or on a sync. Open the popup and:

1. Click **Sync Done to YouTube**. The popup reads `/api/done` and `/api/library` from the Library URL and shows how many videos need syncing (it skips videos already at 95%+ on YouTube, ones already synced from this browser, and ones skipped before because they are live, private, unavailable or age-restricted).
2. Read the count, then click **Start** (or **Not now**). Nothing happens before you confirm.
3. One video at a time, the extension opens `youtube.com/watch?v=ID` in a small, muted popup window (unfocused, top-left), waits for the player, seeks with `video.currentTime` to about 4 seconds before the end, lets the player play to the end, waits a few seconds so YouTube's own player saves progress, then closes the window. Ads: it clicks Skip when offered and otherwise waits up to 45 seconds. Each video has a hard 100-second limit and is marked failed instead of hanging.
4. The popup shows `Video n of N · synced, skipped, failed` and a **Cancel** button. You can close and reopen the popup; progress is kept. **Retry skipped videos** clears the skipped list.

Notes: Chrome does not load video in hidden background tabs, so a small real window is used. If your OS still hides it (for example it is fully covered), the extension brings it to the front once and retries. Please leave that window alone while it runs. Synced IDs are remembered in this browser's extension storage (not shared between Chrome profiles). It uses only the player's own seek and playback, with no YouTube internal API calls and no faked requests. No new permissions: it uses the existing `storage`, `tabs`, `scripting` and `youtube.com` host access. A hidden storage key `watchBase` (default `https://www.youtube.com/watch`) exists only so tests can point at a local page.

### Install / update (Mac, Chrome or Arc)

1. Unzip `extension/watch-later-sync.zip` (or `watch-later-sync-1.4.0.zip`) to a folder you keep, for example `~/watch-later-sync`.
2. Open `chrome://extensions` (Arc: `arc://extensions`) and turn on **Developer mode**.
3. If 1.3.0 is installed unpacked from another folder, click **Remove** on it first (or point **Load unpacked** at the new folder; reloading the old folder after overwriting its files also works).
4. Click **Load unpacked** and pick the unzipped folder. The popup should show **Sync Done to YouTube** and `chrome://extensions` should list version 1.4.0. Your Library URL and sync secret are stored per install, so re-enter them if you removed the old copy.
5. First try with a couple of videos: mark 1–2 videos Done in the library, click **Sync Done to YouTube**, confirm, and watch the small window run. Then check YouTube history or the Watch Later progress bar (refresh the page), and run **Sync Watch Later** to see the library pick up the new progress.

## Verify a full scrape (v1.3.0)

1. `chrome://extensions` → reload the unpacked `extension/` folder, or unzip `extension/watch-later-sync.zip` and load that folder
2. Stay signed into YouTube, then click **Sync Watch Later** once on `https://www.youtube.com/playlist?list=WL`
3. The popup should show a scraped count near the header's video count, and the method used. Refresh the library. Expect `partial: false` on `/api/library` when the scrape reached about 98% of that count, no “Sync incomplete” banner, and **Saved** order matching Watch Later from top to bottom
