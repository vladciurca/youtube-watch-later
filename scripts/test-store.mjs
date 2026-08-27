import assert from "node:assert/strict";
import { loadExistingLibrary, loadLiveLibrary, saveLiveLibrary } from "../api/_lib/store.mjs";

const BLOB_PATH = "watch-later/library.json";
const BLOB_URL = `https://store_example.private.blob.vercel-storage.com/${BLOB_PATH}`;
const TOKEN = "vercel_blob_rw_test_token_not_real";
const library = {
  live: true,
  syncedAt: "2026-08-27T20:00:00.000Z",
  videos: [{ id: "dQw4w9wgGcQ", title: "Example" }],
};

function streamFrom(value) {
  return new Blob([JSON.stringify(value)], { type: "application/json" }).stream();
}

function mockSdk({ onList, onGet, onPut, getImpl, listImpl } = {}) {
  return {
    async list(options) {
      onList?.(options);
      if (listImpl) return listImpl(options);
      return {
        blobs: [{ pathname: BLOB_PATH, url: BLOB_URL }],
      };
    },
    async get(urlOrPath, options) {
      onGet?.(urlOrPath, options);
      if (getImpl) return getImpl(urlOrPath, options);
      return { statusCode: 200, stream: streamFrom(library) };
    },
    async put(pathname, body, options) {
      onPut?.(pathname, body, options);
      return { pathname, url: BLOB_URL };
    },
  };
}

const previousToken = process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.BLOB_READ_WRITE_TOKEN;

assert.equal(await loadLiveLibrary(), null);

await assert.rejects(
  () => saveLiveLibrary(library),
  /BLOB_READ_WRITE_TOKEN is not configured/,
);

process.env.BLOB_READ_WRITE_TOKEN = TOKEN;

const listCalls = [];
const getCalls = [];
const putCalls = [];
const sdk = mockSdk({
  onList: (options) => listCalls.push(options),
  onGet: (urlOrPath, options) => getCalls.push({ urlOrPath, options }),
  onPut: (pathname, body, options) => putCalls.push({ pathname, body, options }),
});

let unauthenticatedFetch = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  const headers = new Headers(options.headers);
  if (String(url).includes("blob.vercel-storage.com") && !headers.get("authorization")) {
    unauthenticatedFetch += 1;
  }
  return originalFetch(url, options);
};

try {
  const loaded = await loadLiveLibrary(sdk);
  assert.deepEqual(loaded, library);
  assert.equal(getCalls.length, 1);
  assert.equal(getCalls[0].urlOrPath, BLOB_PATH);
  assert.equal(getCalls[0].options.access, "private");
  assert.equal(getCalls[0].options.token, TOKEN);
  assert.equal(getCalls[0].options.useCache, false);
  assert.equal(listCalls.length, 0, "successful get(pathname) must not require list()");

  await saveLiveLibrary(library, sdk);
  assert.equal(putCalls.length, 1);
  assert.equal(putCalls[0].pathname, BLOB_PATH);
  assert.equal(putCalls[0].options.access, "private");
  assert.equal(putCalls[0].options.token, TOKEN);
  assert.equal(putCalls[0].options.allowOverwrite, true);
  assert.equal(putCalls[0].options.addRandomSuffix, false);
  assert.equal(JSON.parse(putCalls[0].body).live, true);

  const existing = await loadExistingLibrary(undefined, sdk);
  assert.equal(existing.live, true);
  assert.equal(unauthenticatedFetch, 0);

  const getThenList = [];
  const listed = await loadLiveLibrary(
    mockSdk({
      getImpl: async (urlOrPath) => {
        getThenList.push(urlOrPath);
        if (urlOrPath === BLOB_PATH) return null;
        return { statusCode: 200, stream: streamFrom(library) };
      },
      listImpl: async () => ({
        blobs: [
          {
            pathname: "watch-later/library-abc123.json",
            url: `${BLOB_URL}-abc123`,
            uploadedAt: "2026-08-27T20:00:00.000Z",
          },
        ],
      }),
      onList: (options) => {
        assert.equal(options.token, TOKEN);
        assert.equal(options.prefix, "watch-later/");
      },
    }),
  );
  assert.deepEqual(listed, library);
  assert.deepEqual(getThenList, [BLOB_PATH, "watch-later/library-abc123.json"]);

  const fetchOnlySdk = {
    async list(options) {
      assert.equal(options.token, TOKEN);
      return { blobs: [{ pathname: BLOB_PATH, url: BLOB_URL }] };
    },
  };
  let bearerFetch = 0;
  globalThis.fetch = async (url, options = {}) => {
    const headers = new Headers(options.headers);
    if (String(url) === BLOB_URL) {
      bearerFetch += 1;
      assert.equal(headers.get("authorization"), `Bearer ${TOKEN}`);
      return new Response(JSON.stringify(library), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  const viaBearer = await loadLiveLibrary(fetchOnlySdk);
  assert.deepEqual(viaBearer, library);
  assert.equal(bearerFetch, 1);

  const v2NotFound = await loadLiveLibrary(
    mockSdk({
      getImpl: async () => null,
      listImpl: async () => ({ blobs: [] }),
    }),
  );
  assert.equal(v2NotFound, null);
} finally {
  globalThis.fetch = originalFetch;
  if (previousToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = previousToken;
}

console.log("store tests: private put + get(pathname) without list, list fallback, bearer ok");
