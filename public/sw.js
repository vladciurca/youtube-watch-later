/* Watch Later offline cache: app shell, last library/done/queue/downloaded responses, thumbnails. */
const VERSION = "wl-offline-v3";
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;
const THUMBS = `${VERSION}-thumbs`;
const MAX_THUMBS = 400;

const PRECACHE = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/icons/icon-180.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/data/videos.json",
];

const DATA_PATHS = new Set(["/api/library", "/api/done", "/api/queue", "/api/downloaded", "/data/videos.json"]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => !key.startsWith(`${VERSION}-`)).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

function isNavigation(request) {
  return request.mode === "navigate" || (request.method === "GET" && (request.headers.get("accept") || "").includes("text/html"));
}

function offlinePayload(cached) {
  const headers = new Headers(cached.headers);
  headers.set("X-Offline-Cache", "1");
  return new Response(cached.body, {
    status: cached.status,
    statusText: cached.statusText,
    headers,
  });
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === "opaque")) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);
  return cached || network;
}

async function networkFirstNav(request) {
  const cache = await caches.open(SHELL);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) {
      cache.put(request, fresh.clone());
      cache.put("/", fresh.clone());
      cache.put("/index.html", fresh.clone());
    }
    return fresh;
  } catch {
    return (
      (await cache.match(request)) ||
      (await cache.match("/")) ||
      (await cache.match("/index.html")) ||
      new Response("Offline", { status: 503, statusText: "Offline" })
    );
  }
}

async function networkFirstData(request) {
  const cache = await caches.open(DATA);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) await cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return offlinePayload(cached);
    throw new Error("Offline and no cached data");
  }
}

async function trimThumbs(cache) {
  const keys = await cache.keys();
  const extra = keys.length - MAX_THUMBS;
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}

async function cacheThumbs(request) {
  const cache = await caches.open(THUMBS);
  const cached = await cache.match(request);
  if (cached) {
    // Refresh LRU order by re-inserting the hit.
    await cache.put(request, cached.clone());
    return cached;
  }
  try {
    const fresh = await fetch(request, { mode: "no-cors" });
    if (fresh && (fresh.ok || fresh.type === "opaque")) {
      await cache.put(request, fresh.clone());
      await trimThumbs(cache);
    }
    return fresh;
  } catch {
    if (cached) return cached;
    throw new Error("Offline thumbnail");
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (isNavigation(request)) {
      event.respondWith(networkFirstNav(request));
      return;
    }
    if (DATA_PATHS.has(url.pathname)) {
      event.respondWith(networkFirstData(request));
      return;
    }
    if (url.pathname.startsWith("/api/")) return;
    event.respondWith(staleWhileRevalidate(request, SHELL));
    return;
  }

  if (url.hostname === "i.ytimg.com") {
    event.respondWith(cacheThumbs(request));
    return;
  }

  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(staleWhileRevalidate(request, SHELL));
  }
});
