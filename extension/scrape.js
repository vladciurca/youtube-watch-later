(() => {
  const WL_URL = "https://www.youtube.com/playlist?list=WL";

  function textOf(node) {
    if (!node) return "";
    if (typeof node === "string") return node;
    if (typeof node.simpleText === "string") return node.simpleText;
    if (Array.isArray(node.runs)) {
      return node.runs.map((run) => run.text ?? "").join("");
    }
    return "";
  }

  function parseDuration(text) {
    if (typeof text !== "string") return 0;
    const parts = text
      .trim()
      .split(":")
      .map((part) => Number(part));
    if (parts.length === 0 || parts.some((part) => !Number.isFinite(part))) {
      return 0;
    }
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0];
  }

  function watchedPctFromRenderer(renderer) {
    const overlays = renderer.thumbnailOverlays;
    if (Array.isArray(overlays)) {
      for (const overlay of overlays) {
        const pct = overlay?.thumbnailOverlayResumePlaybackRenderer?.percentDurationWatched;
        if (Number.isFinite(Number(pct))) return Number(pct);
      }
    }
    return 0;
  }

  function normalizeRenderer(renderer) {
    const id = renderer.videoId;
    if (!id || typeof id !== "string") return null;
    const durationText = textOf(renderer.lengthText);
    const durationSec = Number(renderer.lengthSeconds) || parseDuration(durationText);
    const start = renderer.navigationEndpoint?.watchEndpoint?.startTimeSeconds;
    return {
      id,
      title: textOf(renderer.title),
      author:
        textOf(renderer.shortBylineText) ||
        textOf(renderer.longBylineText) ||
        textOf(renderer.ownerText),
      duration: durationText,
      durationSec,
      watchedPct: watchedPctFromRenderer(renderer),
      t: Number.isFinite(Number(start)) ? Number(start) : undefined,
    };
  }

  function findPlaylistContents(root) {
    if (!root || typeof root !== "object") return null;
    if (Array.isArray(root.playlistVideoListRenderer?.contents)) {
      return root.playlistVideoListRenderer.contents;
    }
    if (Array.isArray(root)) {
      for (const item of root) {
        const found = findPlaylistContents(item);
        if (found) return found;
      }
      return null;
    }
    for (const value of Object.values(root)) {
      if (value && typeof value === "object") {
        const found = findPlaylistContents(value);
        if (found) return found;
      }
    }
    return null;
  }

  function continuationToken(node) {
    return (
      node?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ||
      node?.FAKESECRET_o1p2q3r4s5t6u7v8w9x0?.continuation ||
      null
    );
  }

  function collectFromItems(items, videos) {
    let next = null;
    if (!Array.isArray(items)) return next;
    for (const item of items) {
      if (item?.playlistVideoRenderer) {
        const video = normalizeRenderer(item.playlistVideoRenderer);
        if (video) videos.push(video);
      }
      const token = continuationToken(item);
      if (token) next = token;
    }
    return next;
  }

  function collectFromBrowse(payload, videos) {
    const contents = findPlaylistContents(payload);
    let next = collectFromItems(contents, videos);
    const received =
      payload?.onResponseReceivedActions ||
      payload?.onResponseReceivedEndpoints ||
      [];
    for (const action of received) {
      const items =
        action?.appendContinuationItemsAction?.continuationItems ||
        action?.reloadContinuationItemsCommand?.continuationItems;
      const token = collectFromItems(items, videos);
      if (token) next = token;
    }
    return next;
  }

  async function scrapeInnertube() {
    const ytcfg = window.ytcfg;
    const initial = window.ytInitialData;
    if (!ytcfg || !initial) return null;

    const apiKey = ytcfg.get?.("INNERTUBE_API_KEY");
    const context = ytcfg.get?.("INNERTUBE_CONTEXT");
    if (!apiKey || !context) return null;

    const videos = [];
    const seen = new Set();
    let continuation = collectFromBrowse(initial, videos);
    for (const video of videos) seen.add(video.id);

    let guard = 0;
    while (continuation && guard < 80) {
      guard += 1;
      const response = await fetch(
        `/youtubei/v1/browse?key=${encodeURIComponent(apiKey)}&prettyPrint=false`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ context, continuation }),
        },
      );
      if (!response.ok) break;
      const payload = await response.json();
      const batch = [];
      continuation = collectFromBrowse(payload, batch);
      for (const video of batch) {
        if (seen.has(video.id)) continue;
        seen.add(video.id);
        videos.push(video);
      }
    }

    if (videos.length === 0) return null;
    return { videos, method: "innertube" };
  }

  function progressFromRow(row) {
    const overlay = row.querySelector("ytd-thumbnail-overlay-resume-playback-renderer");
    const fromData = overlay?.data?.percentDurationWatched;
    if (Number.isFinite(Number(fromData))) return Number(fromData);
    const bar = overlay?.querySelector("#progress, .style-scope.ytd-thumbnail-overlay-resume-playback-renderer");
    const width = bar?.style?.width;
    if (width?.endsWith("%")) {
      const n = Number.parseFloat(width);
      if (Number.isFinite(n)) return n;
    }
    return 0;
  }

  function videoIdFromHref(href) {
    try {
      return new URL(href, location.origin).searchParams.get("v");
    } catch {
      return null;
    }
  }

  async function scrapeDom() {
    const seen = new Map();
    let stagnant = 0;
    for (let i = 0; i < 120 && stagnant < 10; i += 1) {
      const rows = document.querySelectorAll("ytd-playlist-video-renderer");
      const before = seen.size;
      for (const row of rows) {
        const href =
          row.querySelector("a#video-title")?.href ||
          row.querySelector("a#thumbnail")?.href ||
          "";
        const id = videoIdFromHref(href);
        if (!id || seen.has(id)) continue;
        const duration =
          row.querySelector("ytd-thumbnail-overlay-time-status-renderer #text")
            ?.textContent?.trim() || "";
        seen.set(id, {
          id,
          title: row.querySelector("#video-title")?.textContent?.trim() || "",
          author:
            row.querySelector("#channel-name")?.textContent?.trim() ||
            row.querySelector("ytd-channel-name")?.innerText?.trim() ||
            "",
          duration,
          durationSec: parseDuration(duration),
          watchedPct: progressFromRow(row),
        });
      }
      if (seen.size === before) stagnant += 1;
      else stagnant = 0;
      rows[rows.length - 1]?.scrollIntoView({ block: "end" });
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    const videos = [...seen.values()];
    if (videos.length === 0) return null;
    return { videos, method: "dom" };
  }

  function signedOut() {
    const text = document.body?.innerText?.slice(0, 4000) ?? "";
    return /sign in to|want to watch this again later/i.test(text);
  }

  window.__watchLaterScrape = async function watchLaterScrape() {
    if (!location.href.includes("list=WL")) {
      throw new Error(`Not on Watch Later (${location.href}). Open ${WL_URL}.`);
    }
    const innertube = await scrapeInnertube();
    if (innertube) return innertube;
    const dom = await scrapeDom();
    if (dom) return dom;
    if (signedOut()) {
      throw new Error("YouTube is signed out. Sign in to Chrome, then sync again.");
    }
    throw new Error("Could not read Watch Later videos from this page.");
  };
})();
