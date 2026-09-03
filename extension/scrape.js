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
  const FIRST_PAGE_MAX = 120;
  const TRUNCATED_RATIO = 0.8;
  const TRUNCATED_MIN_EXPECTED = 50;

  function textOf(node) {
    if (!node) return "";
    if (typeof node === "string") return node;
    if (typeof node.simpleText === "string") return node.simpleText;
    if (typeof node.content === "string") return node.content;
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
    return findPercentDurationWatched(renderer);
  }

  function findPercentDurationWatched(node, depth = 0) {
    if (!node || typeof node !== "object" || depth > 8) return 0;
    const direct = node.percentDurationWatched;
    if (Number.isFinite(Number(direct))) return Number(direct);
    const kids = Array.isArray(node) ? node : Object.values(node);
    for (const child of kids) {
      const found = findPercentDurationWatched(child, depth + 1);
      if (found) return found;
    }
    return 0;
  }

  function videoRecord({
    id,
    title,
    author,
    duration,
    durationSec,
    watchedPct,
    start,
    savedRank,
    index,
    publishedLabel,
  }) {
    return {
      id,
      title: title || "",
      author: author || "",
      duration: duration || "",
      durationSec: durationSec || 0,
      watchedPct: Number.isFinite(Number(watchedPct)) ? Number(watchedPct) : 0,
      t: Number.isFinite(Number(start)) ? Number(start) : undefined,
      savedRank: Number.isFinite(savedRank) && savedRank >= 0 ? savedRank : null,
      index: Number.isFinite(index) && index >= 1 ? index : undefined,
      publishedLabel: publishedLabel || null,
      publishedTimeText: publishedLabel || null,
      publishedAt: parsePublishedRelative(publishedLabel),
    };
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
    return videoRecord({
      id,
      title: textOf(renderer.title),
      author:
        textOf(renderer.shortBylineText) ||
        textOf(renderer.longBylineText) ||
        textOf(renderer.ownerText),
      duration: durationText,
      durationSec,
      watchedPct: watchedPctFromRenderer(renderer),
      start,
      savedRank,
      index,
      publishedLabel,
    });
  }

  function collectStrings(node, texts, depth, maxDepth) {
    if (!node || typeof node !== "object" || depth > maxDepth) return;
    if (typeof node.content === "string") texts.push(node.content);
    if (typeof node.simpleText === "string") texts.push(node.simpleText);
    if (typeof node.text === "string") texts.push(node.text);
    if (Array.isArray(node.runs)) texts.push(textOf(node));
    const kids = Array.isArray(node) ? node : Object.values(node);
    for (const child of kids) {
      if (child && typeof child === "object") {
        collectStrings(child, texts, depth + 1, maxDepth);
      }
    }
  }

  function durationFromLockup(lockup) {
    const texts = [];
    collectStrings(lockup?.contentImage, texts, 0, 8);
    for (const text of texts) {
      const trimmed = String(text).trim();
      if (/^\d+:\d{2}(?::\d{2})?$/.test(trimmed)) return trimmed;
    }
    return "";
  }

  function authorAndPublishedFromLockup(lockup) {
    const rows =
      lockup?.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel
        ?.metadataRows;
    const labels = [];
    if (Array.isArray(rows)) {
      for (const row of rows) {
        const parts = row?.metadataParts;
        if (!Array.isArray(parts)) continue;
        for (const part of parts) {
          const text = textOf(part.text) || textOf(part);
          if (text) labels.push(text);
        }
      }
    }
    const publishedLabel = labels.map(extractRelativePublished).find(Boolean) || "";
    return { author: labels[0] || "", publishedLabel };
  }

  function normalizeLockup(lockup) {
    if (!lockup || typeof lockup !== "object") return null;
    const contentType = lockup.contentType;
    if (contentType && contentType !== "LOCKUP_CONTENT_TYPE_VIDEO") return null;
    const watch =
      lockup.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint;
    const id =
      (typeof watch?.videoId === "string" && watch.videoId) ||
      (typeof lockup.contentId === "string" ? lockup.contentId : null);
    if (!id) return null;
    const duration = durationFromLockup(lockup);
    const { author, publishedLabel } = authorAndPublishedFromLockup(lockup);
    return videoRecord({
      id,
      title: textOf(lockup.metadata?.lockupMetadataViewModel?.title),
      author,
      duration,
      durationSec: parseDuration(duration),
      watchedPct: findPercentDurationWatched(lockup),
      start: watch?.startTimeSeconds,
      savedRank: null,
      publishedLabel,
    });
  }

  function itemVideoRenderer(item) {
    return (
      item?.playlistVideoRenderer ||
      item?.playlistPanelVideoRenderer ||
      item?.richItemRenderer?.content?.playlistVideoRenderer ||
      item?.richItemRenderer?.content?.videoRenderer
    );
  }

  function itemLockup(item) {
    return (
      item?.lockupViewModel ||
      item?.richItemRenderer?.content?.lockupViewModel
    );
  }

  function isWatchLaterPlaylist(renderer) {
    if (!renderer || !Array.isArray(renderer.contents)) return false;
    if (renderer.playlistId === "WL") return true;
    for (const item of renderer.contents) {
      const playlistId =
        item?.playlistVideoRenderer?.navigationEndpoint?.watchEndpoint?.playlistId ||
        itemLockup(item)?.rendererContext?.commandContext?.onTap?.innertubeCommand
          ?.watchEndpoint?.playlistId;
      if (playlistId === "WL") return true;
    }
    return false;
  }

  function tokenFromCommand(command) {
    if (!command || typeof command !== "object") return null;
    if (typeof command.continuationCommand?.token === "string") {
      return command.continuationCommand.token;
    }
    if (typeof command.token === "string" && command.continuationCommand == null) {
      if (command.request || command.clickTrackingParams) return command.token;
    }
    const nested = command.commandExecutorCommand?.commands;
    if (Array.isArray(nested)) {
      for (const inner of nested) {
        const token = tokenFromCommand(inner);
        if (token) return token;
      }
    }
    if (command.innertubeCommand) {
      const token = tokenFromCommand(command.innertubeCommand);
      if (token) return token;
    }
    return null;
  }

  function continuationToken(node) {
    if (!node || typeof node !== "object") return null;
    const renderer = node.continuationItemRenderer;
    const viewModel = node.continuationItemViewModel;
    return (
      tokenFromCommand(renderer?.continuationEndpoint) ||
      tokenFromCommand(renderer?.button?.buttonRenderer?.command) ||
      tokenFromCommand(viewModel?.continuationCommand) ||
      (typeof viewModel?.continuationCommand?.token === "string"
        ? viewModel.continuationCommand.token
        : null) ||
      tokenFromCommand(viewModel?.continuationCommand?.innertubeCommand) ||
      node.FAKESECRET_o1p2q3r4s5t6u7v8w9x0?.continuation ||
      node.nextContinuationData?.continuation ||
      tokenFromCommand(node) ||
      (typeof node.continuationCommand?.token === "string"
        ? node.continuationCommand.token
        : null) ||
      null
    );
  }

  function tokenFromContinuations(continuations) {
    if (!Array.isArray(continuations)) return null;
    let next = null;
    for (const item of continuations) {
      const token =
        continuationToken(item) ||
        (typeof item?.continuation === "string" ? item.continuation : null);
      if (token) next = token;
    }
    return next;
  }

  function collectVideoFromItem(item, videos) {
    const renderer = itemVideoRenderer(item);
    if (renderer) {
      const video = normalizeRenderer(renderer);
      if (video) videos.push(video);
      return;
    }
    const video = normalizeLockup(itemLockup(item));
    if (video) videos.push(video);
  }

  function collectFromItems(items, videos) {
    let next = null;
    if (!Array.isArray(items)) return next;
    for (const item of items) {
      collectVideoFromItem(item, videos);
      const token = continuationToken(item);
      if (token) next = token;
    }
    return next;
  }

  function collectFromPlaylistRenderer(renderer, videos) {
    if (!renderer) return null;
    let next = collectFromItems(renderer.contents, videos);
    const legacy = tokenFromContinuations(renderer.continuations);
    if (legacy) next = legacy;
    return next;
  }

  function pushContinuationItemLists(node, lists) {
    if (!node || typeof node !== "object") return;
    const items =
      node.continuationItems ||
      node.appendContinuationItemsAction?.continuationItems ||
      node.reloadContinuationItemsCommand?.continuationItems;
    if (Array.isArray(items)) lists.push(items);
    const commands = node.commandExecutorCommand?.commands;
    if (Array.isArray(commands)) {
      for (const command of commands) pushContinuationItemLists(command, lists);
    }
  }

  function collectKnownContinuationPaths(payload, videos) {
    let next = null;
    const lists = [];
    const received = [
      ...(Array.isArray(payload?.onResponseReceivedActions)
        ? payload.onResponseReceivedActions
        : []),
      ...(Array.isArray(payload?.onResponseReceivedEndpoints)
        ? payload.onResponseReceivedEndpoints
        : []),
      ...(Array.isArray(payload?.onResponseReceivedCommands)
        ? payload.onResponseReceivedCommands
        : []),
    ];
    for (const action of received) {
      pushContinuationItemLists(action, lists);
    }

    const continuationContents = payload?.continuationContents;
    if (continuationContents && typeof continuationContents === "object") {
      for (const value of Object.values(continuationContents)) {
        if (!value || typeof value !== "object") continue;
        if (Array.isArray(value.contents)) lists.push(value.contents);
        const legacy = tokenFromContinuations(value.continuations);
        if (legacy) next = legacy;
        if (value.playlistVideoListRenderer) {
          const token = collectFromPlaylistRenderer(
            value.playlistVideoListRenderer,
            videos,
          );
          if (token) next = token;
        }
      }
    }

    for (const items of lists) {
      const token = collectFromItems(items, videos);
      if (token) next = token;
    }
    return next;
  }

  function walkPlaylistVideosAndTokens(root, videos) {
    let next = null;
    const seen = new Set();
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if (seen.has(node)) continue;
      seen.add(node);

      if (node.playlistVideoRenderer || node.playlistPanelVideoRenderer) {
        const video = normalizeRenderer(
          node.playlistVideoRenderer || node.playlistPanelVideoRenderer,
        );
        if (video) videos.push(video);
        continue;
      }

      if (node.lockupViewModel) {
        const video = normalizeLockup(node.lockupViewModel);
        if (video) videos.push(video);
        continue;
      }

      if (node.playlistVideoListRenderer) {
        const token = collectFromPlaylistRenderer(node.playlistVideoListRenderer, videos);
        if (token) next = token;
      }

      const token = continuationToken(node);
      if (token) next = token;

      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i -= 1) {
          if (node[i] && typeof node[i] === "object") stack.push(node[i]);
        }
      } else {
        const values = Object.values(node);
        for (let i = values.length - 1; i >= 0; i -= 1) {
          if (values[i] && typeof values[i] === "object") stack.push(values[i]);
        }
      }
    }
    return next;
  }

  function collectContinuations(payload, videos) {
    const known = collectKnownContinuationPaths(payload, videos);
    const walked = walkPlaylistVideosAndTokens(payload, videos);
    return known || walked;
  }

  function collectBrowseWatchLater(root, videos) {
    const tabs = root?.contents?.twoColumnBrowseResultsRenderer?.tabs;
    if (!Array.isArray(tabs)) return { found: false, next: null };
    for (const tab of tabs) {
      const sectionList = tab?.tabRenderer?.content?.sectionListRenderer;
      const sections = sectionList?.contents;
      if (!Array.isArray(sections)) continue;
      let found = false;
      let next = null;
      for (const section of sections) {
        const items = section?.itemSectionRenderer?.contents;
        if (Array.isArray(items)) {
          for (const item of items) {
            if (isWatchLaterPlaylist(item?.playlistVideoListRenderer)) {
              found = true;
              const token = collectFromPlaylistRenderer(
                item.playlistVideoListRenderer,
                videos,
              );
              if (token) next = token;
            } else {
              const token = continuationToken(item);
              if (token) next = token;
            }
          }
        }
        const sectionToken = continuationToken(section);
        if (sectionToken) next = sectionToken;
      }
      const listToken =
        continuationToken(sectionList) ||
        tokenFromContinuations(sectionList?.continuations);
      if (listToken) next = listToken;
      if (found) return { found: true, next };
    }
    return { found: false, next: null };
  }

  function collectInitial(payload, videos) {
    const browse = collectBrowseWatchLater(payload, videos);
    if (browse.found) {
      const continued = collectKnownContinuationPaths(payload, videos);
      return continued || browse.next;
    }

    const matches = [];
    const seen = new Set();
    const stack = [payload];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if (seen.has(node)) continue;
      seen.add(node);
      const renderer = node.playlistVideoListRenderer;
      if (isWatchLaterPlaylist(renderer)) {
        matches.push(renderer);
        continue;
      }
      const kids = Array.isArray(node) ? node : Object.values(node);
      for (const child of kids) {
        if (child && typeof child === "object") stack.push(child);
      }
    }
    matches.sort((a, b) => (b.contents?.length || 0) - (a.contents?.length || 0));
    let next = collectFromPlaylistRenderer(matches[0], videos);
    const continued = collectKnownContinuationPaths(payload, videos);
    return continued || next;
  }

  function countFromVideoLabel(text) {
    if (typeof text !== "string") return null;
    const match = text.replace(/,/g, "").match(/(\d+)\s+videos?/i);
    if (!match) return null;
    const n = Number(match[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function playlistCountHint(payload) {
    const texts = [];
    const stack = [payload?.header, payload?.sidebar, payload?.metadata];
    const seen = new Set();
    let guard = 0;
    while (stack.length && guard < 400) {
      guard += 1;
      const node = stack.pop();
      if (!node || typeof node !== "object" || seen.has(node)) continue;
      seen.add(node);
      const label = textOf(node);
      if (label) texts.push(label);
      const kids = Array.isArray(node) ? node : Object.values(node);
      for (const child of kids) {
        if (child && typeof child === "object") stack.push(child);
      }
    }
    for (const text of texts) {
      const n = countFromVideoLabel(text);
      if (n) return n;
    }
    return null;
  }

  function looksTruncated(videoCount, options = {}) {
    const n = Number(videoCount) || 0;
    if (n <= 0) return true;
    const expected = Number(options.expectedCount);
    if (Number.isFinite(expected) && expected >= TRUNCATED_MIN_EXPECTED) {
      return n < TRUNCATED_RATIO * expected;
    }
    const pagesFetched = Number(options.pagesFetched) || 0;
    return options.method === "innertube" && n <= FIRST_PAGE_MAX && pagesFetched <= 1;
  }

  function uniqueVideoCount(videos) {
    const ids = new Set();
    for (const video of videos || []) {
      if (video?.id) ids.add(video.id);
    }
    return ids.size;
  }

  function pickRicherScrape(primary, fallback) {
    if (!fallback?.videos?.length) return primary || null;
    if (!primary?.videos?.length) return fallback;
    if (uniqueVideoCount(fallback.videos) > uniqueVideoCount(primary.videos)) {
      return fallback;
    }
    return primary;
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

  function innertubeHeaders(ytcfg, context) {
    const headers = { "content-type": "application/json" };
    const clientName = ytcfg.get?.("INNERTUBE_CONTEXT_CLIENT_NAME");
    const clientVersion =
      ytcfg.get?.("INNERTUBE_CLIENT_VERSION") || context?.client?.clientVersion;
    const visitor = ytcfg.get?.("VISITOR_DATA") || context?.client?.visitorData;
    const idToken = ytcfg.get?.("ID_TOKEN");
    if (clientName != null && clientName !== "") {
      headers["x-youtube-client-name"] = String(clientName);
    }
    if (clientVersion) headers["x-youtube-client-version"] = String(clientVersion);
    if (visitor) headers["x-goog-visitor-id"] = visitor;
    if (idToken) headers["x-youtube-identity-token"] = idToken;
    return headers;
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
    const playlistCount = playlistCountHint(initial);
    let continuation = collectInitial(initial, videos);
    for (const video of videos) seen.add(video.id);

    const MAX_PAGES = 250;
    const MAX_EMPTY_PAGES = 3;
    let guard = 0;
    let emptyStreak = 0;
    let previousToken = null;
    const headers = innertubeHeaders(ytcfg, context);
    while (continuation && guard < MAX_PAGES) {
      if (continuation === previousToken) break;
      previousToken = continuation;
      guard += 1;
      const response = await fetch(
        `/youtubei/v1/browse?key=${encodeURIComponent(apiKey)}&prettyPrint=false`,
        {
          method: "POST",
          headers,
          credentials: "same-origin",
          body: JSON.stringify({ context, continuation }),
        },
      );
      if (!response.ok) break;
      const payload = await response.json();
      if (payload?.error) break;
      const batch = [];
      continuation = collectContinuations(payload, batch);
      let added = 0;
      for (const video of batch) {
        if (seen.has(video.id)) continue;
        seen.add(video.id);
        videos.push(video);
        added += 1;
      }
      if (added === 0) {
        emptyStreak += 1;
        if (emptyStreak >= MAX_EMPTY_PAGES) break;
      } else {
        emptyStreak = 0;
      }
    }

    if (videos.length === 0) return null;
    return {
      videos: finalizeRanks(videos),
      method: "innertube",
      pagesFetched: guard,
      playlistCount,
    };
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

  function resolveExpectedCount(options, innertube) {
    const fromCaller = Number(options?.expectedCount);
    if (Number.isFinite(fromCaller) && fromCaller > 0) return fromCaller;
    const fromPlaylist = Number(innertube?.playlistCount);
    if (Number.isFinite(fromPlaylist) && fromPlaylist > 0) return fromPlaylist;
    return null;
  }

  window.__watchLaterScrapeHelpers = {
    continuationToken,
    looksTruncated,
    pickRicherScrape,
    normalizeLockup,
    playlistCountHint,
  };

  window.__watchLaterScrape = async function watchLaterScrape(options = {}) {
    if (!location.href.includes("list=WL")) {
      throw new Error(`Not on Watch Later (${location.href}). Open ${WL_URL}.`);
    }
    const innertube = await scrapeInnertube();
    const expectedCount = resolveExpectedCount(options, innertube);
    const innertubeTruncated =
      !innertube ||
      looksTruncated(innertube.videos.length, {
        expectedCount,
        method: innertube.method,
        pagesFetched: innertube.pagesFetched,
      });
    if (innertube && !innertubeTruncated) return innertube;

    const dom = await scrapeDom();
    const picked = pickRicherScrape(innertube, dom);
    if (picked) return picked;
    if (signedOut()) {
      throw new Error("YouTube is signed out. Sign in to Chrome, then sync again.");
    }
    throw new Error("Could not read Watch Later videos from this page.");
  };
})();
