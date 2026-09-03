import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = dirname(fileURLToPath(import.meta.url));
const scrapeSource = readFileSync(join(root, "../extension/scrape.js"), "utf8");
const backgroundSource = readFileSync(join(root, "../extension/background.js"), "utf8");
const manifest = JSON.parse(readFileSync(join(root, "../extension/manifest.json"), "utf8"));

function videoId(i) {
  return `v${String(i).padStart(10, "0")}`;
}

function playlistVideoItem(i) {
  return {
    playlistVideoRenderer: {
      videoId: videoId(i),
      title: { simpleText: `Video ${i}` },
      shortBylineText: { simpleText: "Channel" },
      lengthText: { simpleText: "1:00" },
      lengthSeconds: "60",
      index: { simpleText: String(i + 1) },
    },
  };
}

function lockupVideoItem(i) {
  return {
    lockupViewModel: {
      contentId: videoId(i),
      contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
      metadata: {
        lockupMetadataViewModel: {
          title: { content: `Video ${i}` },
          metadata: {
            contentMetadataViewModel: {
              metadataRows: [
                { metadataParts: [{ text: { content: "Channel" } }] },
                { metadataParts: [{ text: { content: "3 weeks ago" } }] },
              ],
            },
          },
        },
      },
      contentImage: {
        thumbnailViewModel: {
          overlays: [
            {
              thumbnailOverlayBadgeViewModel: {
                thumbnailBadges: [{ thumbnailBadgeViewModel: { text: "1:00" } }],
              },
            },
            {
              thumbnailOverlayResumePlaybackRenderer: { percentDurationWatched: 12 },
            },
          ],
        },
      },
      rendererContext: {
        commandContext: {
          onTap: {
            innertubeCommand: {
              watchEndpoint: { videoId: videoId(i), playlistId: "WL" },
            },
          },
        },
      },
    },
  };
}

function continuationItem(token) {
  return {
    continuationItemRenderer: {
      continuationEndpoint: {
        continuationCommand: { token },
      },
    },
  };
}

function commandExecutorContinuationItem(token) {
  return {
    continuationItemRenderer: {
      continuationEndpoint: {
        commandExecutorCommand: {
          commands: [{ continuationCommand: { token } }],
        },
      },
    },
  };
}

function continuationViewModelItem(token) {
  return {
    continuationItemViewModel: {
      continuationCommand: {
        innertubeCommand: {
          continuationCommand: { token },
        },
      },
    },
  };
}

function itemsRange(start, count, factory = playlistVideoItem) {
  return Array.from({ length: count }, (_, i) => factory(start + i));
}

function initialPage(count, token, { headerCount, tokenFactory = continuationItem } = {}) {
  const page = {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  contents: [
                    {
                      itemSectionRenderer: {
                        contents: [
                          {
                            playlistVideoListRenderer: {
                              playlistId: "WL",
                              contents: itemsRange(0, count),
                            },
                          },
                        ],
                      },
                    },
                    token ? tokenFactory(token) : undefined,
                  ].filter(Boolean),
                },
              },
            },
          },
        ],
      },
    },
  };
  if (headerCount) {
    page.header = {
      playlistHeaderRenderer: {
        numVideosText: { simpleText: `${headerCount} videos` },
      },
    };
  }
  return page;
}

function endpointsPage(start, count, token, { emptyActions = false, factory } = {}) {
  const continuationItems = itemsRange(start, count, factory);
  if (token) continuationItems.push(continuationItem(token));
  return {
    onResponseReceivedActions: emptyActions ? [] : undefined,
    onResponseReceivedEndpoints: [
      {
        appendContinuationItemsAction: { continuationItems },
      },
    ],
  };
}

function continuationContentsPage(start, count, token) {
  const contents = itemsRange(start, count);
  if (token) contents.push(continuationItem(token));
  return {
    continuationContents: {
      playlistVideoListContinuation: { contents },
    },
  };
}

function nestedCommandPage(start, count, token) {
  const continuationItems = itemsRange(start, count);
  if (token) continuationItems.push(continuationItem(token));
  return {
    onResponseReceivedEndpoints: [
      {
        commandExecutorCommand: {
          commands: [
            {
              appendContinuationItemsAction: { continuationItems },
            },
          ],
        },
      },
    ],
  };
}

function commandsPage(start, count, token, factory = lockupVideoItem) {
  const continuationItems = itemsRange(start, count, factory);
  if (token) continuationItems.push(continuationViewModelItem(token));
  return {
    onResponseReceivedCommands: [
      {
        appendContinuationItemsAction: { continuationItems },
      },
    ],
  };
}

function playlistRendererPage(start, count, token) {
  const contents = itemsRange(start, count);
  if (token) contents.push(continuationItem(token));
  return {
    contents: {
      playlistVideoListRenderer: {
        playlistId: "WL",
        contents,
      },
    },
  };
}

function emptyTokenPage(token) {
  return {
    onResponseReceivedEndpoints: [
      {
        appendContinuationItemsAction: {
          continuationItems: [continuationItem(token)],
        },
      },
    ],
  };
}

function makeDomRow(video, i) {
  return {
    querySelector(sel) {
      if (sel === "a#video-title" || sel === "a#thumbnail") {
        return { href: `https://www.youtube.com/watch?v=${video.id}` };
      }
      if (sel === "#video-title") return { textContent: video.title };
      if (sel === "#channel-name" || sel === "ytd-channel-name") {
        return { textContent: video.author, innerText: video.author };
      }
      if (sel.includes("time-status")) return { textContent: video.duration };
      if (sel === "#index" || sel === "#index-container") {
        return { textContent: String(i + 1) };
      }
      if (sel.includes("video-info") || sel.includes("meta") || sel.includes("metadata")) {
        return { innerText: video.publishedLabel || "", textContent: video.publishedLabel || "" };
      }
      return null;
    },
    innerText: `${video.title} ${video.author}`,
    scrollIntoView() {},
  };
}

function loadScrape({ initial, pages, domVideos = [] }) {
  const fetchCalls = [];
  const queue = [...pages];
  let domQueries = 0;
  const windowObj = {
    ytcfg: {
      get(key) {
        if (key === "INNERTUBE_API_KEY") return "test-key";
        if (key === "INNERTUBE_CONTEXT") {
          return { client: { clientName: "WEB", clientVersion: "2.20260903.00.00" } };
        }
        if (key === "INNERTUBE_CLIENT_VERSION") return "2.20260903.00.00";
        if (key === "INNERTUBE_CONTEXT_CLIENT_NAME") return "1";
        if (key === "VISITOR_DATA") return "visitor-test";
        return null;
      },
    },
    ytInitialData: initial,
  };
  const context = vm.createContext({
    window: windowObj,
    location: {
      href: "https://www.youtube.com/playlist?list=WL",
      origin: "https://www.youtube.com",
    },
    document: {
      body: { innerText: "" },
      querySelectorAll: (sel) => {
        if (sel !== "ytd-playlist-video-renderer") return [];
        domQueries += 1;
        return domVideos.map((video, i) => makeDomRow(video, i));
      },
    },
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      const body = JSON.parse(options.body);
      assert.equal(typeof body.continuation, "string");
      const page = queue.shift();
      if (!page) {
        return { ok: true, json: async () => ({}) };
      }
      return { ok: true, json: async () => page };
    },
    setTimeout: (fn) => {
      fn();
      return 0;
    },
    URL,
    Set,
    Map,
    Number,
    Date,
    Array,
    Object,
    JSON,
    Math,
    Promise,
    String,
    parseInt: Number.parseInt,
  });
  vm.runInContext(scrapeSource, context);
  return {
    scrape: windowObj.__watchLaterScrape,
    helpers: windowObj.__watchLaterScrapeHelpers,
    fetchCalls,
    remaining: queue,
    getDomQueries: () => domQueries,
  };
}

function domVideo(i) {
  return {
    id: videoId(i),
    title: `DOM ${i}`,
    author: "Channel",
    duration: "1:00",
    publishedLabel: "2 weeks ago",
  };
}

const PAGE = 100;

{
  const pages = [
    endpointsPage(100, PAGE, "tok-endpoints", { emptyActions: true }),
    continuationContentsPage(200, PAGE, "tok-contents"),
    nestedCommandPage(300, PAGE, "tok-nested"),
    playlistRendererPage(400, PAGE, null),
  ];
  const { scrape, fetchCalls, getDomQueries } = loadScrape({
    initial: initialPage(PAGE, "tok-sibling"),
    pages,
  });
  const result = await scrape();
  assert.equal(result.method, "innertube");
  assert.equal(result.videos.length, 500);
  assert.equal(result.videos[0].id, videoId(0));
  assert.equal(result.videos[99].id, videoId(99));
  assert.equal(result.videos[100].id, videoId(100));
  assert.equal(result.videos[499].id, videoId(499));
  assert.equal(fetchCalls.length, 4);
  assert.equal(JSON.parse(fetchCalls[0].options.body).continuation, "tok-sibling");
  assert.equal(fetchCalls[0].options.headers["x-goog-visitor-id"], "visitor-test");
  assert.equal(getDomQueries(), 0);
}

{
  const pages = Array.from({ length: 21 }, (_, page) => {
    const start = (page + 1) * PAGE;
    const next = page === 20 ? null : `tok-${page + 1}`;
    return endpointsPage(start, PAGE, next);
  });
  const { scrape, fetchCalls } = loadScrape({
    initial: initialPage(PAGE, "tok-0"),
    pages,
  });
  const result = await scrape();
  assert.equal(result.videos.length, 2200);
  assert.equal(fetchCalls.length, 21);
  assert.equal(result.videos[2199].id, videoId(2199));
}

{
  const loopingToken = "tok-loop";
  const pages = Array.from({ length: 40 }, () => emptyTokenPage(loopingToken));
  const { scrape, fetchCalls } = loadScrape({
    initial: initialPage(PAGE, loopingToken),
    pages,
  });
  const result = await scrape();
  assert.equal(result.videos.length, PAGE);
  assert.ok(fetchCalls.length <= 3, `empty-token loop ran ${fetchCalls.length} fetches`);
}

{
  const { scrape, fetchCalls } = loadScrape({
    initial: initialPage(PAGE, "tok-exec", { tokenFactory: commandExecutorContinuationItem }),
    pages: [commandsPage(100, PAGE, "tok-view"), endpointsPage(200, PAGE, null, { factory: lockupVideoItem })],
  });
  const result = await scrape();
  assert.equal(result.method, "innertube");
  assert.equal(result.videos.length, 300);
  assert.equal(result.videos[100].id, videoId(100));
  assert.equal(result.videos[100].title, "Video 100");
  assert.equal(result.videos[100].author, "Channel");
  assert.equal(result.videos[100].duration, "1:00");
  assert.equal(result.videos[100].watchedPct, 12);
  assert.equal(result.videos[100].publishedLabel, "3 weeks ago");
  assert.equal(JSON.parse(fetchCalls[0].options.body).continuation, "tok-exec");
  assert.equal(JSON.parse(fetchCalls[1].options.body).continuation, "tok-view");
}

{
  const { scrape, getDomQueries } = loadScrape({
    initial: initialPage(PAGE, null),
    pages: [],
    domVideos: Array.from({ length: 250 }, (_, i) => domVideo(i)),
  });
  const result = await scrape();
  assert.equal(result.method, "dom");
  assert.equal(result.videos.length, 250);
  assert.ok(getDomQueries() > 0);
}

{
  const { scrape, getDomQueries } = loadScrape({
    initial: initialPage(PAGE, "tok-one"),
    pages: [endpointsPage(100, PAGE, null)],
    domVideos: Array.from({ length: 676 }, (_, i) => domVideo(i)),
  });
  const result = await scrape({ expectedCount: 676 });
  assert.equal(result.method, "dom");
  assert.equal(result.videos.length, 676);
  assert.ok(getDomQueries() > 0);
}

{
  const { scrape, getDomQueries } = loadScrape({
    initial: initialPage(PAGE, null, { headerCount: 500 }),
    pages: [],
    domVideos: Array.from({ length: 480 }, (_, i) => domVideo(i)),
  });
  const result = await scrape();
  assert.equal(result.method, "dom");
  assert.equal(result.videos.length, 480);
  assert.ok(getDomQueries() > 0);
}

{
  const { helpers } = loadScrape({
    initial: initialPage(1, null),
    pages: [],
  });
  assert.equal(
    helpers.continuationToken(commandExecutorContinuationItem("tok-a")).length > 0,
    true,
  );
  assert.equal(helpers.continuationToken(commandExecutorContinuationItem("tok-a")), "tok-a");
  assert.equal(helpers.continuationToken(continuationViewModelItem("tok-b")), "tok-b");
  assert.equal(helpers.continuationToken(continuationItem("tok-c")), "tok-c");
  assert.equal(helpers.looksTruncated(100, { method: "innertube", pagesFetched: 0 }), true);
  assert.equal(helpers.looksTruncated(100, { method: "innertube", pagesFetched: 1 }), true);
  assert.equal(helpers.looksTruncated(500, { method: "innertube", pagesFetched: 4 }), false);
  assert.equal(helpers.looksTruncated(200, { expectedCount: 676 }), true);
  assert.equal(helpers.looksTruncated(650, { expectedCount: 676 }), false);
  assert.equal(
    helpers.pickRicherScrape({ videos: [{ id: "a" }] }, { videos: [{ id: "a" }, { id: "b" }] })
      .videos.length,
    2,
  );
  assert.equal(
    helpers.pickRicherScrape({ videos: [{ id: "a" }, { id: "b" }] }, { videos: [{ id: "a" }] })
      .videos.length,
    2,
  );
  const lockup = helpers.normalizeLockup(lockupVideoItem(7).lockupViewModel);
  assert.equal(lockup.id, videoId(7));
  assert.equal(lockup.title, "Video 7");
  assert.equal(lockup.durationSec, 60);
  assert.equal(helpers.playlistCountHint(initialPage(1, null, { headerCount: 676 })), 676);
}

assert.equal(manifest.version, "1.2.1");
assert.match(backgroundSource, /previousOnListCount/);
assert.match(backgroundSource, /expectedCount/);
assert.equal(scrapeSource.includes("console."), false);
assert.match(scrapeSource, /MAX_PAGES = 250/);
assert.match(scrapeSource, /continuationItemViewModel/);
assert.match(scrapeSource, /onResponseReceivedCommands/);
assert.match(scrapeSource, /lockupViewModel/);
assert.doesNotMatch(scrapeSource, /onResponseReceivedActions \|\|/);

console.log(
  "scrape tests: sibling token, continuation shapes, lockup/viewModel, 2200 videos, empty-loop guard, truncated DOM fallback ok",
);
