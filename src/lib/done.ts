import { applyDoneOp, applyDoneOverrides, emptyDone, normalizeDone } from "../../api/_lib/done.mjs";
import type { DoneList, DoneOp } from "../../api/_lib/done.mjs";

export type { DoneList, DoneOp };
export { applyDoneOp, applyDoneOverrides, emptyDone, normalizeDone };

export async function fetchDone(): Promise<DoneList> {
  const response = await fetch("/api/done", { cache: "no-store" });
  if (!response.ok) throw new Error(`Done request failed (${response.status})`);
  return normalizeDone(await response.json());
}

export async function sendDoneOp(op: DoneOp): Promise<DoneList> {
  const response = await fetch("/api/done", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op }),
  });
  if (!response.ok) {
    let detail = "";
    try {
      detail = ((await response.json()) as { error?: string }).error ?? "";
    } catch {
      // ignore
    }
    throw new Error(detail || `Could not save (${response.status})`);
  }
  return normalizeDone(await response.json());
}
