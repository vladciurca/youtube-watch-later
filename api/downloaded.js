import { applyDoneOverrides } from "./_lib/done.mjs";
import {
  applyDownloadedOp,
  downloadedIds,
  pruneDoneFromDownloaded,
} from "./_lib/downloaded.mjs";
import { handleOptions, json, readJsonBody } from "./_lib/http.mjs";
import { isDoneVideo } from "./_lib/threshold.mjs";
import { isVideoId } from "./_lib/queue.mjs";
import {
  loadDone,
  loadDownloaded,
  loadExistingLibrary,
  loadLiveLibrary,
  saveDownloaded,
} from "./_lib/store.mjs";

function view(list) {
  return {
    ok: true,
    updatedAt: list.updatedAt,
    items: list.items,
    ids: downloadedIds(list),
  };
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    if (req.method === "GET") {
      let list = await loadDownloaded();
      if (list.items.length > 0) {
        try {
          const live = await loadLiveLibrary();
          let done = null;
          try {
            done = await loadDone();
          } catch {
            // progress-based Done only
          }
          const pruned = pruneDoneFromDownloaded(
            list,
            applyDoneOverrides(live?.videos ?? [], done),
          );
          if (pruned.removed.length > 0) {
            list = pruned.list;
            await saveDownloaded(list);
          }
        } catch {
          // Serve the stored list if the library cannot be read right now.
        }
      }
      json(res, 200, view(list));
      return;
    }

    if (req.method !== "POST") {
      json(res, 405, { error: "Method not allowed" });
      return;
    }
    if (!sameOrigin(req)) {
      json(res, 403, { error: "Forbidden" });
      return;
    }

    let body;
    try {
      body = await readJsonBody(req, 20_000);
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "Invalid body" });
      return;
    }

    const op = body?.op;
    if (
      !op ||
      (op.type !== "downloaded" && op.type !== "undownloaded") ||
      !isVideoId(op.id)
    ) {
      json(res, 400, { error: "Expected { op: { type: 'downloaded' | 'undownloaded', id } }" });
      return;
    }

    if (op.type === "downloaded") {
      const library = await loadExistingLibrary(req);
      let done = null;
      try {
        done = await loadDone();
      } catch {
        // progress-based Done only
      }
      const video = applyDoneOverrides(library.videos ?? [], done).find(
        (item) => item?.id === op.id,
      );
      if (!video) {
        json(res, 404, { error: "Video is not in the library" });
        return;
      }
      if (isDoneVideo(video)) {
        json(res, 409, { error: "Done videos cannot be marked downloaded" });
        return;
      }
    }

    const current = await loadDownloaded();
    const next = applyDownloadedOp(current, op);
    if (next.items.length !== current.items.length) await saveDownloaded(next);
    json(res, 200, view(next));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Downloaded failed";
    json(res, message.includes("BLOB_READ_WRITE_TOKEN") ? 503 : 500, { error: message });
  }
}
