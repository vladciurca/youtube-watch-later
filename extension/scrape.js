(() => {
  const WL_URL = "https://www.youtube.com/playlist?list=WL";
  const RELATIVE_DATE_RE =
    /(?:(?:streamed|premiered)\s+)?(\d+)\s*(months?|weeks?|days?|hours?|minutes?|seconds?|years?|mos|mo|wks?|hrs?|mins?|secs?|yrs?|[dhsmyw])\s+ago/i;
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
  const COMPLETE_RATIO = 0.98;
  const MAX_VIDEOS = 5000;
  const MAX_PAGES = 80;
  const MAX_EMPTY_PAGES = 3;
  const SAPISID_ORIGIN = "https://www.youtube.com";

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

  function normalizeRelativeUnit(unit) {
    const u = String(unit || "").toLowerCase();
    if (u === "mo" || u === "mos" || u.startsWith("month")) return "month";
    if (u === "m" || u.startsWith("min")) return "minute";
    if (u === "y" || u.startsWith("yr") || u.startsWith("year")) return "year";
    if (u === "w" || u.startsWith("wk") || u.startsWith("week")) return "week";
    if (u === "d" || u.startsWith("day")) return "day";
    if (u === "h" || u.startsWith("hr") || u.startsWith("hour")) return "hour";
    if (u === "s" || u.startsWith("sec") || u.startsWith("second")) return "second";
    return null;
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
    const unit = normalizeRelativeUnit(match[2]);
    const ms = unit ? UNIT_MS[unit] : 0;
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
      savedRank: null,
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
          const bits = [
            textOf(part?.text),
            part?.accessibilityLabel,
            part?.text?.accessibility?.accessibilityData?.label,
          ];
          for (const bit of bits) {
            if (typeof bit === "string" && bit.trim()) labels.push(bit.trim());
          }
        }
      }
    }
    const dates = labels.map((label) => extractRelativePublished(label)).filter(Boolean);
    dates.sort((a, b) => b.length - a.length);
    const publishedLabel = dates[0] || "";
    const author =
      labels.find((label) => label && !extractRelativePublished(label) && !/^\d/.test(label)) ||
      "";
    return { author, publishedLabel };
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
    return item?.lockupViewModel || item?.richItemRenderer?.content?.lockupViewModel;
  }

  function playlistIdOfRenderer(renderer) {
    return renderer?.navigationEndpoint?.watchEndpoint?.playlistId || null;
  }

  function playlistIdOfLockup(lockup) {
    return (
      lockup?.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint
        ?.playlistId || null
    );
  }

  function videoFromItem(item) {
    if (!item || typeof item !== "object") return null;
    const renderer = itemVideoRenderer(item);
    if (renderer) {
      const video = normalizeRenderer(renderer);
      if (!video) return null;
      video._playlistId = playlistIdOfRenderer(renderer);
      return video;
    }
    const lockup = itemLockup(item);
    if (!lockup) return null;
    const video = normalizeLockup(lockup);
    if (!video) return null;
    video._playlistId = playlistIdOfLockup(lockup);
    return video;
  }

  function isWatchLaterPlaylist(renderer) {
    if (!renderer || !Array.isArray(renderer.contents)) return false;
    if (renderer.playlistId === "WL") return true;
    for (const item of renderer.contents) {
      const playlistId =
        playlistIdOfRenderer(item?.playlistVideoRenderer) ||
        playlistIdOfLockup(itemLockup(item));
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
      tokenFromCommand(viewModel?.continuationEndpoint) ||
      tokenFromCommand(viewModel?.continuationCommand) ||
      (typeof viewModel?.continuationCommand?.token === "string"
        ? viewModel.continuationCommand.token
        : null) ||
      tokenFromCommand(viewModel?.continuationCommand?.innertubeCommand) ||
      (typeof node.continuationEndpoint?.continuationCommand?.token === "string"
        ? node.continuationEndpoint.continuationCommand.token
        : null) ||
      (typeof node.nextContinuationData?.continuation === "string"
        ? node.nextContinuationData.continuation
        : null) ||
      tokenFromCommand(node) ||
      (typeof node.continuationCommand?.token === "string" ? node.continuationCommand.token : null) ||
      null
    );
  }

  function findApiUrl(node, depth = 0) {
    if (!node || typeof node !== "object" || depth > 8) return null;
    const direct = node.commandMetadata?.webCommandMetadata?.apiUrl;
    if (typeof direct === "string" && direct.includes("/youtubei/")) return direct;
    const kids = Array.isArray(node) ? node : Object.values(node);
    for (const child of kids) {
      if (!child || typeof child !== "object") continue;
      const found = findApiUrl(child, depth + 1);
      if (found) return found;
    }
    return null;
  }

  function continuationInfo(node) {
    const token = continuationToken(node);
    if (!token) return null;
    return { token, apiUrl: findApiUrl(node) || "/youtubei/v1/browse" };
  }

  function tokenFromContinuations(continuations) {
    if (!Array.isArray(continuations)) return null;
    let next = null;
    for (const item of continuations) {
      const info =
        continuationInfo(item) ||
        (typeof item?.continuation === "string"
          ? { token: item.continuation, apiUrl: "/youtubei/v1/browse" }
          : null);
      if (info) next = info;
    }
    return next;
  }

  function collectFromItems(items, videos) {
    let next = null;
    if (!Array.isArray(items)) return next;
    for (const item of items) {
      const video = videoFromItem(item);
      if (video) videos.push(video);
      const info = continuationInfo(item);
      if (info) next = info;
    }
    return next;
  }

  function collectFromPlaylistRenderer(renderer, videos) {
    if (!renderer) return null;
    const fromItems = collectFromItems(renderer.contents, videos);
    const legacy = tokenFromContinuations(renderer.continuations);
    return fromItems || legacy;
  }

  function rememberToken(slot, info) {
    if (!info?.token) return slot;
    return info;
  }

  function takeVideos(target, batch, watchLaterOnly) {
    for (const video of batch) {
      if (watchLaterOnly && video._playlistId && video._playlistId !== "WL") continue;
      target.push(video);
    }
  }

  function parseInitialBrowse(payload) {
    const tabs = payload?.contents?.twoColumnBrowseResultsRenderer?.tabs;
    const videos = [];
    let inList = null;
    let sibling = null;
    let sawWatchLater = false;
    if (!Array.isArray(tabs)) {
      return { videos, continuation: null };
    }

    for (const tab of tabs) {
      const sectionList = tab?.tabRenderer?.content?.sectionListRenderer;
      const richGrid = tab?.tabRenderer?.content?.richGridRenderer;
      const sections = sectionList?.contents || richGrid?.contents;
      if (!Array.isArray(sections)) continue;

      for (const section of sections) {
        const sectionInfo = continuationInfo(section);
        if (sectionInfo && !section?.itemSectionRenderer && !section?.richGridRenderer) {
          sibling = rememberToken(sibling, sectionInfo);
        }

        const itemLists = [];
        if (Array.isArray(section?.itemSectionRenderer?.contents)) {
          itemLists.push(section.itemSectionRenderer.contents);
        }
        if (Array.isArray(section?.richGridRenderer?.contents)) {
          itemLists.push(section.richGridRenderer.contents);
        }

        const looseItems = itemLists.length ? [] : [section];
        for (const items of itemLists.length ? itemLists : [looseItems]) {
          for (const item of items) {
            const renderer = item?.playlistVideoListRenderer;
            if (renderer) {
              const batch = [];
              const info = collectFromPlaylistRenderer(renderer, batch);
              const wl =
                isWatchLaterPlaylist(renderer) || batch.some((video) => video._playlistId === "WL");
              if (wl && !sawWatchLater) {
                videos.length = 0;
                inList = null;
                sawWatchLater = true;
              }
              if (!sawWatchLater || wl) {
                takeVideos(videos, batch, sawWatchLater);
                if (info) inList = info;
              }
              continue;
            }

            const video = videoFromItem(item);
            const info = continuationInfo(item);
            if (video) {
              const wl = video._playlistId === "WL";
              if (wl && !sawWatchLater) {
                videos.length = 0;
                inList = null;
                sawWatchLater = true;
              }
              if (!sawWatchLater || wl || !video._playlistId) {
                if (!(sawWatchLater && video._playlistId && video._playlistId !== "WL")) {
                  videos.push(video);
                }
              }
            }
            if (info && item !== section) inList = info;
            else if (info && item === section && !section?.itemSectionRenderer) {
              sibling = rememberToken(sibling, info);
            }
          }
        }
      }

      const listInfo =
        continuationInfo(sectionList) || tokenFromContinuations(sectionList?.continuations);
      if (listInfo) sibling = rememberToken(sibling, listInfo);
    }

    const chosen = inList || sibling;
    return {
      videos,
      continuation: chosen,
    };
  }

  function pushContinuationItemLists(node, lists, depth = 0) {
    if (!node || typeof node !== "object" || depth > 6) return;
    const items =
      node.continuationItems ||
      node.appendContinuationItemsAction?.continuationItems ||
      node.reloadContinuationItemsCommand?.continuationItems;
    if (Array.isArray(items)) lists.push(items);
    const commands = node.commandExecutorCommand?.commands;
    if (Array.isArray(commands)) {
      for (const command of commands) pushContinuationItemLists(command, lists, depth + 1);
    }
  }

  function consumeLists(lists) {
    const videos = [];
    let continuation = null;
    for (const items of lists) {
      const info = collectFromItems(items, videos);
      if (info) continuation = info;
    }
    return { videos, continuation };
  }

  function parseActionLists(payload) {
    const lists = [];
    const received = [
      ...(Array.isArray(payload?.onResponseReceivedActions) ? payload.onResponseReceivedActions : []),
      ...(Array.isArray(payload?.onResponseReceivedEndpoints)
        ? payload.onResponseReceivedEndpoints
        : []),
      ...(Array.isArray(payload?.onResponseReceivedCommands)
        ? payload.onResponseReceivedCommands
        : []),
    ];
    for (const action of received) pushContinuationItemLists(action, lists);
    if (!lists.length) return { videos: [], continuation: null };
    return consumeLists(lists);
  }

  function parseContinuationContents(payload) {
    const continuationContents = payload?.continuationContents;
    if (!continuationContents || typeof continuationContents !== "object") {
      return { videos: [], continuation: null };
    }
    const videos = [];
    let continuation = null;
    for (const value of Object.values(continuationContents)) {
      if (!value || typeof value !== "object") continue;
      if (Array.isArray(value.contents)) {
        const info = collectFromItems(value.contents, videos);
        if (info) continuation = info;
      }
      const legacy = tokenFromContinuations(value.continuations);
      if (legacy) continuation = legacy;
      if (value.playlistVideoListRenderer) {
        const info = collectFromPlaylistRenderer(value.playlistVideoListRenderer, videos);
        if (info) continuation = info;
      }
    }
    return { videos, continuation };
  }

  function parseLoosePlaylist(payload) {
    const videos = [];
    const direct =
      payload?.contents?.playlistVideoListRenderer || payload?.playlistVideoListRenderer;
    const continuation = direct ? collectFromPlaylistRenderer(direct, videos) : null;
    return { videos, continuation };
  }

  function parseInnertubePlaylistPage(payload) {
    const statedCount = playlistCountHint(payload);
    const fromActions = parseActionLists(payload);
    if (fromActions.videos.length || fromActions.continuation) {
      return { ...fromActions, statedCount };
    }
    const fromContents = parseContinuationContents(payload);
    if (fromContents.videos.length || fromContents.continuation) {
      return { ...fromContents, statedCount };
    }
    const initial = parseInitialBrowse(payload);
    if (initial.videos.length || initial.continuation) {
      return { ...initial, statedCount };
    }
    const loose = parseLoosePlaylist(payload);
    return { ...loose, statedCount };
  }

  function countFromVideoLabel(text) {
    if (typeof text !== "string") return null;
    const match = text.replace(/,/g, "").match(/(\d+)\s+(?:videos?|episodes?)\b/i);
    if (!match) return null;
    const n = Number(match[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function playlistCountHint(payload) {
    const texts = [];
    const stack = [payload?.header, payload?.sidebar, payload?.metadata];
    const seen = new Set();
    let guard = 0;
    while (stack.length && guard < 800) {
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
    let best = null;
    for (const text of texts) {
      const n = countFromVideoLabel(text);
      if (n && (best == null || n > best)) best = n;
    }
    return best;
  }

  function looksTruncated(videoCount, options = {}) {
    const n = Number(videoCount) || 0;
    if (n <= 0) return true;
    const expected = Number(options.expectedCount);
    if (Number.isFinite(expected) && expected > 0) {
      return n < COMPLETE_RATIO * expected;
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
    const cleaned = [];
    const seen = new Set();
    for (const video of videos) {
      if (!video?.id || seen.has(video.id)) continue;
      seen.add(video.id);
      if (cleaned.length >= MAX_VIDEOS) break;
      const next = { ...video };
      delete next._playlistId;
      cleaned.push(next);
    }
    cleaned.forEach((video, i) => {
      video.savedRank = i;
      video.index = i + 1;
    });
    return cleaned;
  }

  function readCookie(name) {
    const raw =
      typeof document === "undefined" || document == null ? "" : String(document.cookie || "");
    for (const part of raw.split(";")) {
      const trimmed = part.trim();
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      if (trimmed.slice(0, eq) === name) return decodeURIComponent(trimmed.slice(eq + 1));
    }
    return "";
  }

  async function sha1Hex(value) {
    if (!globalThis.crypto?.subtle?.digest || typeof TextEncoder === "undefined") return null;
    const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function authorizationHeader() {
    const ts = Math.floor(Date.now() / 1000);
    const sapisid = readCookie("SAPISID");
    const sapisid1p = readCookie("__Secure-1PAPISID");
    const sapisid3p = readCookie("__Secure-3PAPISID");
    const parts = [];
    if (sapisid) {
      const hash = await sha1Hex(`${ts} ${sapisid} ${SAPISID_ORIGIN}`);
      if (hash) parts.push(`SAPISIDHASH ${ts}_${hash}`);
    }
    if (sapisid1p) {
      const hash = await sha1Hex(`${ts} ${sapisid1p} ${SAPISID_ORIGIN}`);
      if (hash) parts.push(`SAPISID1PHASH ${ts}_${hash}`);
    }
    if (sapisid3p) {
      const hash = await sha1Hex(`${ts} ${sapisid3p} ${SAPISID_ORIGIN}`);
      if (hash) parts.push(`SAPISID3PHASH ${ts}_${hash}`);
    }
    return parts.length ? parts.join(" ") : null;
  }

  function buildContext(ytcfg) {
    const raw = ytcfg.get?.("INNERTUBE_CONTEXT");
    const base = raw && typeof raw === "object" ? { ...raw } : {};
    const client = { ...(base.client || {}) };
    client.clientName = "WEB";
    const version = ytcfg.get?.("INNERTUBE_CLIENT_VERSION") || client.clientVersion;
    if (version) client.clientVersion = String(version);
    const visitor = ytcfg.get?.("VISITOR_DATA") || client.visitorData;
    if (visitor) client.visitorData = visitor;
    return { ...base, client };
  }

  async function innertubeHeaders(ytcfg, context) {
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
    const authorization = await authorizationHeader();
    if (authorization) {
      headers.authorization = authorization;
      headers["x-goog-authuser"] = "0";
      headers["x-origin"] = SAPISID_ORIGIN;
    }
    return headers;
  }

  function browseUrl(apiKey, apiUrl) {
    let path = "/youtubei/v1/browse";
    if (typeof apiUrl === "string") {
      const match = apiUrl.match(/\/youtubei\/v1\/[a-zA-Z0-9_]+/);
      if (match) path = match[0];
    }
    return `${path}?key=${encodeURIComponent(apiKey)}&prettyPrint=false`;
  }

  async function scrapeInnertube() {
    const ytcfg = window.ytcfg;
    const initial = window.ytInitialData;
    if (!ytcfg || !initial) return null;

    const apiKey = ytcfg.get?.("INNERTUBE_API_KEY");
    if (!apiKey) return null;
    const context = buildContext(ytcfg);
    if (!context?.client?.clientVersion) return null;

    const first = parseInnertubePlaylistPage(initial);
    const videos = first.videos.slice();
    const seen = new Set();
    for (const video of videos) {
      if (video?.id) seen.add(video.id);
    }
    let continuation = first.continuation;
    let statedCount = first.statedCount;

    let guard = 0;
    let emptyStreak = 0;
    let previousToken = null;
    const headers = await innertubeHeaders(ytcfg, context);
    while (continuation?.token && videos.length < MAX_VIDEOS && guard < MAX_PAGES) {
      if (continuation.token === previousToken) break;
      previousToken = continuation.token;
      guard += 1;
      const response = await fetch(browseUrl(apiKey, continuation.apiUrl), {
        method: "POST",
        headers,
        credentials: "same-origin",
        body: JSON.stringify({ context, continuation: continuation.token }),
      });
      if (!response.ok) break;
      const payload = await response.json();
      if (payload?.error) break;
      const page = parseInnertubePlaylistPage(payload);
      if (!statedCount && page.statedCount) statedCount = page.statedCount;
      continuation = page.continuation;
      let added = 0;
      for (const video of page.videos) {
        if (!video?.id || seen.has(video.id)) continue;
        seen.add(video.id);
        videos.push(video);
        added += 1;
        if (videos.length >= MAX_VIDEOS) break;
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
      playlistCount: statedCount,
      statedCount,
    };
  }

  function progressFromRow(row) {
    const overlay = row.querySelector?.(
      "ytd-thumbnail-overlay-resume-playback-renderer",
    );
    const fromData = overlay?.data?.percentDurationWatched;
    if (Number.isFinite(Number(fromData))) return Number(fromData);
    const bar = overlay?.querySelector?.(
      "#progress, .style-scope.ytd-thumbnail-overlay-resume-playback-renderer",
    );
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

  function idFromRow(row) {
    const href =
      row.querySelector?.("a#video-title")?.href ||
      row.querySelector?.("a#thumbnail")?.href ||
      row.querySelector?.("a[href*='watch?v=']")?.href ||
      "";
    const fromHref = videoIdFromHref(href);
    if (fromHref) return fromHref;
    const dataId = row.data?.contentId || row.data?.videoId || row.contentId;
    if (typeof dataId === "string" && /^[A-Za-z0-9_-]{11}$/.test(dataId)) return dataId;
    return null;
  }

  function publishedFromRow(row) {
    const info =
      row.querySelector?.("#video-info")?.innerText ||
      row.querySelector?.("yt-formatted-string#video-info")?.textContent ||
      row.querySelector?.("ytd-video-meta-block")?.innerText ||
      row.querySelector?.(".yt-content-metadata-view-model")?.innerText ||
      row.querySelector?.("yt-content-metadata-view-model")?.innerText ||
      "";
    return extractRelativePublished(info) || extractRelativePublished(row.innerText || "");
  }

  function titleFromRow(row) {
    return (
      row.querySelector?.("#video-title")?.textContent?.trim() ||
      row.querySelector?.(".yt-lockup-metadata-view-model__title")?.textContent?.trim() ||
      row.querySelector?.("h3")?.textContent?.trim() ||
      ""
    );
  }

  function authorFromRow(row) {
    return (
      row.querySelector?.("#channel-name")?.textContent?.trim() ||
      row.querySelector?.("ytd-channel-name")?.innerText?.trim() ||
      row.querySelector?.(".yt-content-metadata-view-model__metadata-text")?.textContent?.trim() ||
      ""
    );
  }

  function durationFromRow(row) {
    return (
      row.querySelector?.("ytd-thumbnail-overlay-time-status-renderer #text")?.textContent?.trim() ||
      row.querySelector?.("badge-shape, .yt-badge-shape__text")?.textContent?.trim() ||
      ""
    );
  }

  function playlistRows() {
    const selectors = [
      "ytd-playlist-video-renderer",
      "yt-lockup-view-model",
      "ytd-rich-item-renderer",
    ];
    const rows = [];
    for (const selector of selectors) {
      const list = document.querySelectorAll?.(selector);
      if (!list) continue;
      for (const row of list) rows.push(row);
    }
    return rows;
  }

  function statedCountFromDom() {
    const selectors = [
      "ytd-playlist-sidebar-primary-info-renderer",
      "ytd-playlist-header-renderer",
      "yt-page-header-renderer",
      "yt-content-metadata-view-model",
    ];
    let best = null;
    for (const selector of selectors) {
      const nodes = document.querySelectorAll?.(selector);
      if (!nodes) continue;
      for (const node of nodes) {
        const n = countFromVideoLabel(node.innerText || node.textContent || "");
        if (n && (best == null || n > best)) best = n;
      }
    }
    return best;
  }

  function scrollPlaylist(rows) {
    const last = rows[rows.length - 1];
    last?.scrollIntoView?.({ block: "end" });
    const continuation = document.querySelector?.("ytd-continuation-item-renderer");
    continuation?.scrollIntoView?.({ block: "end" });
    const scroller = document.scrollingElement || document.documentElement;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    if (typeof window.scrollTo === "function") window.scrollTo(0, 1e9);
  }

  async function scrapeDom(statedHint) {
    const seen = new Map();
    let stagnant = 0;
    const stated = statedCountFromDom() || (Number(statedHint) > 0 ? Number(statedHint) : null);
    for (let i = 0; i < 200 && stagnant < 8 && seen.size < MAX_VIDEOS; i += 1) {
      const rows = playlistRows();
      const before = seen.size;
      for (const row of rows) {
        const id = idFromRow(row);
        if (!id || seen.has(id)) continue;
        const duration = durationFromRow(row);
        const publishedLabel = publishedFromRow(row);
        const savedRank = seen.size;
        seen.set(id, {
          id,
          title: titleFromRow(row),
          author: authorFromRow(row),
          duration,
          durationSec: parseDuration(duration),
          watchedPct: progressFromRow(row),
          savedRank,
          index: savedRank + 1,
          publishedLabel: publishedLabel || null,
          publishedTimeText: publishedLabel || null,
          publishedAt: parsePublishedRelative(publishedLabel),
        });
        if (seen.size >= MAX_VIDEOS) break;
      }
      if (stated && seen.size >= stated) break;
      if (seen.size === before) stagnant += 1;
      else stagnant = 0;
      scrollPlaylist(rows);
      await new Promise((resolve) => setTimeout(resolve, 450));
    }
    const videos = [...seen.values()];
    if (videos.length === 0) return null;
    return {
      videos: finalizeRanks(videos),
      method: "dom",
      playlistCount: stated,
      statedCount: stated,
    };
  }

  function signedOut() {
    const text = document.body?.innerText?.slice(0, 4000) ?? "";
    return /sign in to|want to watch this again later/i.test(text);
  }

  function resolveExpectedCount(options, statedCount) {
    const fromPlaylist = Number(statedCount);
    if (Number.isFinite(fromPlaylist) && fromPlaylist > 0) return fromPlaylist;
    const fromCaller = Number(options?.expectedCount);
    if (Number.isFinite(fromCaller) && fromCaller > 0) return fromCaller;
    return null;
  }

  window.__watchLaterScrapeHelpers = {
    continuationToken,
    parseInnertubePlaylistPage,
    looksTruncated,
    pickRicherScrape,
    normalizeLockup,
    playlistCountHint,
    countFromVideoLabel,
    parsePublishedRelative,
    COMPLETE_RATIO,
    MAX_VIDEOS,
  };

  window.__watchLaterScrape = async function watchLaterScrape(options = {}) {
    if (!location.href.includes("list=WL")) {
      throw new Error(`Not on Watch Later (${location.href}). Open ${WL_URL}.`);
    }
    const innertube = await scrapeInnertube();
    const expectedCount = resolveExpectedCount(
      options,
      innertube?.statedCount ?? innertube?.playlistCount,
    );
    const innertubeTruncated =
      !innertube ||
      looksTruncated(innertube.videos.length, {
        expectedCount,
        method: innertube.method,
        pagesFetched: innertube.pagesFetched,
      });
    if (innertube && !innertubeTruncated) {
      return { ...innertube, statedCount: expectedCount ?? innertube.statedCount ?? null };
    }

    const dom = await scrapeDom(expectedCount);
    const picked = pickRicherScrape(innertube, dom);
    if (picked) {
      const statedCount =
        picked.statedCount || expectedCount || dom?.statedCount || innertube?.statedCount || null;
      return { ...picked, statedCount };
    }
    if (signedOut()) {
      throw new Error("YouTube is signed out. Sign in to Chrome, then sync again.");
    }
    throw new Error("Could not read Watch Later videos from this page.");
  };
})();
