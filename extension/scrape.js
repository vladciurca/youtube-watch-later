(() => {
  const WL_URL = "https://www.youtube.com/playlist?list=WL";
  const RELATIVE_DATE_RE =
    /(?:(?:streamed|premiered)\s+)?(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i;
  const UNIT_MS = {
    second: 1000,
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 7 * 86_400_000,
    month: 30 * 86_400_000,
    year: 365 * 86_400_000,
  };

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

  function extractRelativePublished(text) {
    if (typeof text !== "string") return "";
    const match = text.match(RELATIVE_DATE_RE);
    return match ? match[0].trim() : "";
  }

  function parsePublishedRelative(text, now = Date.now()) {
    if (typeof text !== "string") return null;
    const cleaned = text.trim();
    if (!cleaned) return null;
    if (/^just now$/i.test(cleaned)) return new Date(now).toISOString();
    const match = cleaned.match(RELATIVE_DATE_RE);
    if (!match) return null;
    const n = Number(match[1]);
    const unit = match[2].toLowerCase();
    const ms = UNIT_MS[unit];
    if (!Number.isFinite(n) || n < 0 || !ms) return null;
    return new Date(now - n * ms).toISOString();
  }

  function publishedFromRenderer(renderer) {
    const direct = textOf(renderer.publishedTimeText).trim();
    if (extractRelativePublished(direct)) return extractRelativePublished(direct);
    const fromInfo = extractRelativePublished(textOf(renderer.videoInfo));
    if (fromInfo) return fromInfo;
    const label = renderer.title?.accessibility?.accessibilityData?.label || "";
    return extractRelativePublished(label);
  }

  function savedRankFromRenderer(renderer) {
    const indexText = textOf(renderer.index).trim();
    const fromIndex = Number.parseInt(indexText, 10);
    if (Number.isFinite(fromIndex) && fromIndex >= 1) return fromIndex - 1;
    return null;
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
    const publishedLabel = publishedFromRenderer(renderer);
    const savedRank = savedRankFromRenderer(renderer);
    const indexText = textOf(renderer.index).trim();
    const index = Number.parseInt(indexText, 10);
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
      savedRank,
      index: Number.isFinite(index) && index >= 1 ? index : undefined,
      publishedLabel: publishedLabel || null,
      publishedTimeText: publishedLabel || null,
      publishedAt: parsePublishedRelative(publishedLabel),
    };
  }

  function isWatchLaterPlaylist(renderer) {
    if (!renderer || !Array.isArray(renderer.contents)) return false;
    if (renderer.playlistId === "WL") return true;
    for (const item of renderer.contents) {
      const playlistId =
        item?.playlistVideoRenderer?.navigationEndpoint?.watchEndpoint?.playlistId;
      if (playlistId === "WL") return true;
    }
    return false;
  }

  function browsePlaylistContents(root) {
    const tabs = root?.contents?.twoColumnBrowseResultsRenderer?.tabs;
    if (!Array.isArray(tabs)) return null;
    for (const tab of tabs) {
      const sections = tab?.tabRenderer?.content?.sectionListRenderer?.contents;
      if (!Array.isArray(sections)) continue;
      for (const section of sections) {
        const items = section?.itemSectionRenderer?.contents;
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          const renderer = item?.playlistVideoListRenderer;
          if (isWatchLaterPlaylist(renderer)) return renderer.contents;
        }
      }
    }
    return null;
  }

  function findWatchLaterContents(root) {
    const fromBrowse = browsePlaylistContents(root);
    if (fromBrowse) return fromBrowse;

    const matches = [];
    const seen = new Set();
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if (seen.has(node)) continue;
      seen.add(node);
      const renderer = node.playlistVideoListRenderer;
      if (isWatchLaterPlaylist(renderer)) {
        matches.push(renderer.contents);
        continue;
      }
      const kids = Array.isArray(node) ? node : Object.values(node);
      for (const child of kids) {
        if (child && typeof child === "object") stack.push(child);
      }
    }
    if (matches.length === 0) return null;
    matches.sort((a, b) => b.length - a.length);
    return matches[0];
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

  function collectContinuations(payload, videos) {
    let next = null;
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

  function collectInitial(payload, videos) {
    const contents = findWatchLaterContents(payload);
    let next = collectFromItems(contents, videos);
    const continued = collectContinuations(payload, videos);
    return continued || next;
  }

  function finalizeRanks(videos) {
    videos.forEach((video, i) => {
      if (!Number.isFinite(video.savedRank) || video.savedRank < 0) {
        video.savedRank = i;
      }
    });
    videos.sort((a, b) => a.savedRank - b.savedRank || a.title.localeCompare(b.title));
    return videos;
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
    let continuation = collectInitial(initial, videos);
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
      continuation = collectContinuations(payload, batch);
      for (const video of batch) {
        if (seen.has(video.id)) continue;
        seen.add(video.id);
        videos.push(video);
      }
    }

    if (videos.length === 0) return null;
    return { videos: finalizeRanks(videos), method: "innertube" };
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

  function publishedFromRow(row) {
    const info =
      row.querySelector("#video-info")?.innerText ||
      row.querySelector("yt-formatted-string#video-info")?.textContent ||
      row.querySelector("ytd-video-meta-block")?.innerText ||
      row.querySelector(".yt-content-metadata-view-model")?.innerText ||
      "";
    return extractRelativePublished(info) || extractRelativePublished(row.innerText || "");
  }

  function savedRankFromRow(row, fallback) {
    const indexText =
      row.querySelector("#index")?.textContent?.trim() ||
      row.querySelector("#index-container")?.textContent?.trim() ||
      "";
    const fromIndex = Number.parseInt(indexText, 10);
    if (Number.isFinite(fromIndex) && fromIndex >= 1) return fromIndex - 1;
    return fallback;
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
        const publishedLabel = publishedFromRow(row);
        const savedRank = savedRankFromRow(row, seen.size);
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
          savedRank,
          index: Number.isFinite(savedRank) ? savedRank + 1 : undefined,
          publishedLabel: publishedLabel || null,
          publishedTimeText: publishedLabel || null,
          publishedAt: parsePublishedRelative(publishedLabel),
        });
      }
      if (seen.size === before) stagnant += 1;
      else stagnant = 0;
      rows[rows.length - 1]?.scrollIntoView({ block: "end" });
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    const videos = [...seen.values()];
    if (videos.length === 0) return null;
    return { videos: finalizeRanks(videos), method: "dom" };
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
