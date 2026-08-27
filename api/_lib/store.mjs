import { readFile } from "node:fs/promises";
import { join } from "node:path";

const BLOB_PATH = "watch-later/library.json";
const BLOB_PREFIX = "watch-later/";

// Private Blob stores reject access:"public" puts, and blob URLs are not
// anonymously fetchable. Authenticate list/put/get with BLOB_READ_WRITE_TOKEN.
//
// v2 get(pathname|{url}, { access:"private", token, useCache:false }):
//   - 200 → { statusCode:200, stream }
//   - 404 → null
//   - other errors throw
// Prefer get(BLOB_PATH) so a successful put is readable even if list() lags
// or the listed URL is the wrong shape.

function blobToken() {
  return process.env.BLOB_READ_WRITE_TOKEN || "";
}

async function blobSdk(override) {
  if (override) return override;
  return import("@vercel/blob");
}

function isNotFoundError(error) {
  const name = error?.constructor?.name || "";
  if (name === "BlobNotFoundError") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /\b404\b|not found/i.test(message);
}

async function jsonFromStream(stream) {
  if (!stream) return null;
  return new Response(stream).json();
}

async function readPrivateJson(sdk, urlOrPath, token) {
  if (typeof sdk.get === "function") {
    let result;
    try {
      result = await sdk.get(urlOrPath, {
        access: "private",
        token,
        useCache: false,
      });
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
    // v2 returns null on HTTP 404.
    if (result == null) return null;
    if (result.statusCode && result.statusCode !== 200) return null;
    if (!result.stream) return null;
    return jsonFromStream(result.stream);
  }

  if (!/^https?:/i.test(String(urlOrPath))) return null;

  const response = await fetch(urlOrPath, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Failed to fetch blob: ${response.status}`);
  }
  return response.json();
}

function pickLibraryBlob(blobs) {
  if (!Array.isArray(blobs) || blobs.length === 0) return null;
  const exact = blobs.find((item) => item.pathname === BLOB_PATH);
  if (exact) return exact;
  const candidates = blobs.filter((item) =>
    String(item.pathname || "").startsWith("watch-later/library"),
  );
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const aTime = new Date(a.uploadedAt || 0).getTime();
    const bTime = new Date(b.uploadedAt || 0).getTime();
    return bTime - aTime;
  })[0];
}

export async function loadLiveLibrary(sdkOverride) {
  const token = blobToken();
  if (!token) return null;

  const sdk = await blobSdk(sdkOverride);

  if (typeof sdk.get === "function") {
    const direct = await readPrivateJson(sdk, BLOB_PATH, token);
    if (direct?.videos) return direct;
  }

  if (typeof sdk.list !== "function") return null;

  const { blobs } = await sdk.list({
    prefix: BLOB_PREFIX,
    limit: 20,
    token,
  });
  const match = pickLibraryBlob(blobs);
  if (!match) return null;

  const target =
    typeof sdk.get === "function"
      ? match.pathname || BLOB_PATH
      : match.url || match.pathname || BLOB_PATH;
  return readPrivateJson(sdk, target, token);
}

export async function saveLiveLibrary(library, sdkOverride) {
  const token = blobToken();
  if (!token) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
  }

  const sdk = await blobSdk(sdkOverride);
  const result = await sdk.put(BLOB_PATH, JSON.stringify(library), {
    access: "private",
    token,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
  return result;
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
