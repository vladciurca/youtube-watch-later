export interface DoneItem {
  id: string;
  doneAt: string | null;
}
export interface DoneList {
  version: number;
  updatedAt: string | null;
  items: DoneItem[];
}
export type DoneOp = { type: "done" | "undone"; id: string };

export const MAX_DONE: number;
export function emptyDone(): DoneList;
export function normalizeDone(raw: unknown): DoneList;
export function doneIds(done: DoneList): string[];
export function applyDoneOp(done: unknown, op: DoneOp, now?: string): DoneList;
export function applyDoneOverrides<T extends { id?: string }>(videos: T[], done: unknown): T[];
