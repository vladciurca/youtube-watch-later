import {
  applyDownloadedMarks,
  applyDownloadedOp,
  downloadedIds,
  emptyDownloaded,
  normalizeDownloaded,
  pruneDoneFromDownloaded,
} from "../../api/_lib/downloaded.mjs";
import type { DownloadedList, DownloadedOp } from "../../api/_lib/downloaded.mjs";
import { httpError, networkError } from "./sync-error";

export type { DownloadedList, DownloadedOp };
export {
  applyDownloadedMarks,
  applyDownloadedOp,
  downloadedIds,
  emptyDownloaded,
  normalizeDownloaded,
  pruneDoneFromDownloaded,
};

export async function fetchDownloaded(): Promise<DownloadedList> {
  let response: Response;
  try {
    response = await fetch("/api/downloaded", { cache: "no-store" });
  } catch {
    throw networkError("Downloaded request failed");
  }
  if (!response.ok) throw httpError(`Downloaded request failed (${response.status})`, response.status);
  return normalizeDownloaded(await response.json());
}

export async function sendDownloadedOp(op: DownloadedOp): Promise<DownloadedList> {
  let response: Response;
  try {
    response = await fetch("/api/downloaded", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op }),
    });
  } catch {
    throw networkError();
  }
  if (!response.ok) {
    let detail = "";
    try {
      detail = ((await response.json()) as { error?: string }).error ?? "";
    } catch {
      // ignore
    }
    throw httpError(detail || `Could not save (${response.status})`, response.status);
  }
  return normalizeDownloaded(await response.json());
}
