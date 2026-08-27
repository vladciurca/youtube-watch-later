import { readFile } from "node:fs/promises";
import { join } from "node:path";

const BLOB_PATH = "watch-later/library.json";

async function blobApi() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  return import("@vercel/blob");
}

export async function loadLiveLibrary() {
  const blob = await blobApi();
  if (!blob) return null;

  const { blobs } = await blob.list({ prefix: BLOB_PATH, limit: 10 });
  const match = blobs.find((item) => item.pathname === BLOB_PATH);
  if (!match?.url) return null;

  const response = await fetch(match.url, { cache: "no-store" });
  if (!response.ok) return null;
  return response.json();
}

export async function saveLiveLibrary(library) {
  const blob = await blobApi();
  if (!blob) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
  }

  await blob.put(BLOB_PATH, JSON.stringify(library), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 0,
  });
}

export async function loadSeedLibrary(req) {
  try {
    const path = join(process.cwd(), "public/data/videos.json");
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    const host = req?.headers?.["x-forwarded-host"] || req?.headers?.host;
    const proto = req?.headers?.["x-forwarded-proto"] || "https";
    if (!host) return { videos: [] };
    const response = await fetch(`${proto}://${host}/data/videos.json`);
    if (!response.ok) return { videos: [] };
    return response.json();
  }
}

export async function loadExistingLibrary(req) {
  const live = await loadLiveLibrary();
  if (live?.videos?.length) return live;
  return loadSeedLibrary(req);
}
