import { handleOptions, json } from "./_lib/http.mjs";
import { loadLiveLibrary } from "./_lib/store.mjs";

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method !== "GET") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const live = await loadLiveLibrary();
    if (!live?.videos) {
      json(res, 404, { live: false });
      return;
    }
    json(res, 200, live);
  } catch (error) {
    json(res, 500, {
      error: error instanceof Error ? error.message : "Failed to load library",
    });
  }
}
