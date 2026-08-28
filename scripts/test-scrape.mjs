import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = dirname(fileURLToPath(import.meta.url));
const scrapeSource = readFileSync(join(root, "../extension/scrape.js"), "utf8");

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

function continuationItem(token) {
  return {
    continuationItemRenderer: {
      continuationEndpoint: {
        continuationCommand: { token },
      },
    },
  };
}

function itemsRange(start, count) {
  return Array.from({ length: count }, (_, i) => playlistVideoItem(start + i));
}

function initialPage(count, token) {
  return {
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
                    continuationItem(token),
                  ],
                },
              },
            },
          },
        ],
      },
    },
  };
}

function endpointsPage(start, count, token, { emptyActions = false } = {}) {
  const continuationItems = itemsRange(start, count);
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

function loadScrape({ initial, pages }) {
  const fetchCalls = [];
  const queue = [...pages];
  const windowObj = {
    ytcfg: {
      get(key) {
        if (key === "INNERTUBE_API_KEY") return "test-key";
        if (key === "INNERTUBE_CONTEXT") return { client: { clientName: "WEB" } };
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
      querySelectorAll: () => [],
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
  return { scrape: windowObj.__watchLaterScrape, fetchCalls, remaining: queue };
}

const PAGE = 100;

{
  const pages = [
    endpointsPage(100, PAGE, "tok-endpoints", { emptyActions: true }),
    continuationContentsPage(200, PAGE, "tok-contents"),
    nestedCommandPage(300, PAGE, "tok-nested"),
    playlistRendererPage(400, PAGE, null),
  ];
  const { scrape, fetchCalls } = loadScrape({
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

assert.equal(scrapeSource.includes("console."), false);
assert.match(scrapeSource, /MAX_PAGES = 250/);
assert.doesNotMatch(scrapeSource, /onResponseReceivedActions \|\|/);

console.log("scrape tests: sibling token, continuation shapes, 2200 videos, empty-loop guard ok");
