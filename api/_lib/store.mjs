import { readFile } from "node:fs/promises";
import { join } from "node:path";

const BLOB_PATH = "watch-later/library.json";

// Private Blob stores reject access:"public" puts, and blob URLs are not
// anonymously fetchable. Authenticate list/put/get with BLOB_READ_WRITE_TOKEN.

function blobToken() {
  return process.env.BLOB_READ_WRITE_TOKEN || "";
}

async function blobSdk(override) {
  if (override) return override;
  return import("@vercel/blob");
}

async function readPrivateJson(sdk, urlOrPath, token) {
  if (typeof sdk.get === "function") {
    const result = await sdk.get(urlOrPath, {
      access: "private",
      token,
      useCache: false,
    });
    if (result?.statusCode !== 200 || !result.stream) return null;
    return new Response(result.stream).json();
  }

  const response = await fetch(urlOrPath, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  return response.json();
}

export async function loadLiveLibrary(sdkOverride) {
  const token = blobToken();
  if (!token) return null;

  const sdk = await blobSdk(sdkOverride);
  const { blobs } = await sdk.list({
    prefix: BLOB_PATH,
    limit: 10,
    token,
  });
  const match = blobs.find((item) => item.pathname === BLOB_PATH);
  if (!match) return null;

  try {
    return await readPrivateJson(sdk, match.url || BLOB_PATH, token);
  } catch {
    return null;
  }
}

export async function saveLiveLibrary(library, sdkOverride) {
  const token = blobToken();
  if (!token) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
  }

  const sdk = await blobSdk(sdkOverride);
  await sdk.put(BLOB_PATH, JSON.stringify(library), {
    access: "private",
    token,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
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

export async function loadExistingLibrary(req, sdkOverride) {
  const live = await loadLiveLibrary(sdkOverride);
  if (live?.videos?.length) return live;
  return loadSeedLibrary(req);
}
