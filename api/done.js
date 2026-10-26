import { applyDoneOp, doneIds } from "./_lib/done.mjs";
import { handleOptions, json, readJsonBody } from "./_lib/http.mjs";
import { applyQueueOp } from "./_lib/queue.mjs";
import { isVideoId } from "./_lib/queue.mjs";
import { loadDone, loadExistingLibrary, loadQueue, saveDone, saveQueue } from "./_lib/store.mjs";

function view(done) {
  return { ok: true, updatedAt: done.updatedAt, items: done.items, ids: doneIds(done) };
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
      json(res, 200, view(await loadDone()));
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
    if (!op || (op.type !== "done" && op.type !== "undone") || !isVideoId(op.id)) {
      json(res, 400, { error: "Expected { op: { type: 'done' | 'undone', id } }" });
      return;
    }

    if (op.type === "done") {
      const library = await loadExistingLibrary(req);
      if (!(library.videos ?? []).some((video) => video?.id === op.id)) {
        json(res, 404, { error: "Video is not in the library" });
        return;
      }
    }

    const current = await loadDone();
    const next = applyDoneOp(current, op);
    if (next.items.length !== current.items.length) await saveDone(next);

    // Marking done also takes the video off the Queue.
    if (op.type === "done") {
      try {
        const queue = await loadQueue();
        const without = applyQueueOp(queue, { type: "remove", id: op.id });
        if (without.items.length !== queue.items.length) await saveQueue(without);
      } catch {
        // The queue read prunes Done videos anyway.
      }
    }
    json(res, 200, view(next));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Done failed";
    json(res, message.includes("BLOB_READ_WRITE_TOKEN") ? 503 : 500, { error: message });
  }
}
