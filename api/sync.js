import { authorizeSync, handleOptions, json, readJsonBody } from "./_lib/http.mjs";
import { mergeWatchLaterLibrary, normalizeStatedCount } from "./_lib/merge.mjs";
import { loadExistingLibrary, pruneQueueForLibrary, saveLiveLibrary } from "./_lib/store.mjs";

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method !== "POST") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  const auth = authorizeSync(req);
  if (!auth.ok) {
    json(res, auth.status, { error: auth.error });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : "Invalid body" });
    return;
  }

  const scraped = Array.isArray(body.videos) ? body.videos : null;
  if (!scraped) {
    json(res, 400, { error: "Expected { videos: [...] }" });
    return;
  }

  const resetDropped = body.resetDropped === true;

  try {
    const existing = await loadExistingLibrary(req);
    const syncedAt = new Date().toISOString();
    // Ignore a statedCount that is not a finite non-negative integer.
    const statedCount = normalizeStatedCount(body.statedCount);
    const { library, stats } = mergeWatchLaterLibrary(
      existing.videos ?? [],
      scraped,
      syncedAt,
      {
        resetDropped,
        ...(statedCount != null ? { statedCount } : {}),
      },
    );
    await saveLiveLibrary(library);
    // Queue lives in its own blob and is never rewritten by a sync; the only
    // change is that videos that are now Done leave it.
    await pruneQueueForLibrary(library.videos);
    json(res, 200, { ok: true, ...stats, syncedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    const status = message.includes("BLOB_READ_WRITE_TOKEN") ? 503 : 500;
    json(res, status, { error: message });
  }
}
