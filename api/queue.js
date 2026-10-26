import { applyDoneOverrides } from "./_lib/done.mjs";
import { handleOptions, json, readJsonBody } from "./_lib/http.mjs";
import {
  applyQueueOp,
  isDoneVideo,
  isVideoId,
  pruneDoneFromQueue,
  queueIds,
} from "./_lib/queue.mjs";
import {
  loadExistingLibrary,
  loadDone,
  loadLiveLibrary,
  loadQueue,
  saveQueue,
} from "./_lib/store.mjs";

const OPS = new Set(["add", "remove", "top", "up", "down", "reorder"]);

function view(queue) {
  return { ok: true, updatedAt: queue.updatedAt, items: queue.items, ids: queueIds(queue) };
}

// Browser writes must come from this site. (Library data is public, the queue
// is only a list of ids, but a random page should not be able to reorder it.)
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
      let queue = await loadQueue();
      if (queue.items.length > 0) {
        // Done videos leave the queue automatically.
        try {
          const live = await loadLiveLibrary();
          let done = null;
          try {
            done = await loadDone();
          } catch {
            // progress-based Done only
          }
          const pruned = pruneDoneFromQueue(queue, applyDoneOverrides(live?.videos ?? [], done));
          if (pruned.removed.length > 0) {
            queue = pruned.queue;
            await saveQueue(queue);
          }
        } catch {
          // Serve the stored queue if the library cannot be read right now.
        }
      }
      json(res, 200, view(queue));
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
      body = await readJsonBody(req, 100_000);
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "Invalid body" });
      return;
    }

    const op = body?.op;
    if (!op || !OPS.has(op.type)) {
      json(res, 400, { error: "Unknown op" });
      return;
    }
    if (op.type === "reorder") {
      if (!Array.isArray(op.ids) || !op.ids.every(isVideoId)) {
        json(res, 400, { error: "reorder needs ids" });
        return;
      }
    } else if (!isVideoId(op.id)) {
      json(res, 400, { error: "Invalid video id" });
      return;
    }

    if (op.type === "add") {
      // Only real, unfinished videos from the library can be queued.
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
        json(res, 409, { error: "Done videos cannot be queued" });
        return;
      }
    }

    const current = await loadQueue();
    const next = applyQueueOp(current, op);
    if (next !== current && JSON.stringify(next.items) !== JSON.stringify(current.items)) {
      await saveQueue(next);
    }
    json(res, 200, view(next));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Queue failed";
    json(res, message.includes("BLOB_READ_WRITE_TOKEN") ? 503 : 500, { error: message });
  }
}
