import { applyDoneOp, applyDoneOverrides, emptyDone, normalizeDone } from "../../api/_lib/done.mjs";
import type { DoneList, DoneOp } from "../../api/_lib/done.mjs";
import { httpError, networkError } from "./sync-error";

export type { DoneList, DoneOp };
export { applyDoneOp, applyDoneOverrides, emptyDone, normalizeDone };

export async function fetchDone(): Promise<DoneList> {
  let response: Response;
  try {
    response = await fetch("/api/done", { cache: "no-store" });
  } catch {
    throw networkError("Done request failed");
  }
  if (!response.ok) throw httpError(`Done request failed (${response.status})`, response.status);
  return normalizeDone(await response.json());
}

export async function sendDoneOp(op: DoneOp): Promise<DoneList> {
  let response: Response;
  try {
    response = await fetch("/api/done", {
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
  return normalizeDone(await response.json());
}
