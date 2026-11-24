import type { DoneList } from "./done";
import type { Queue } from "./queue";
import type { VideoLibrary } from "../types";
import {
  compactActions,
  enqueueAction,
  flushActions,
  type PendingAction,
} from "./offline-queue.mjs";

const DB_NAME = "watch-later-offline";
const DB_VERSION = 1;
const KV = "kv";
const LIBRARY_KEY = "library";
const DONE_KEY = "done";
const QUEUE_KEY = "queue";
const ACTIONS_KEY = "actions";

export interface CachedLibrary {
  library: VideoLibrary;
  cachedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(KV, "readonly").objectStore(KV).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed"));
    });
  } catch {
    return null;
  }
}

async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction(KV, "readwrite").objectStore(KV).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error("IndexedDB write failed"));
    });
  } catch {
    // Private mode or quota should not break the UI.
  }
}

export async function readLibraryCache(): Promise<CachedLibrary | null> {
  const value = await kvGet<CachedLibrary>(LIBRARY_KEY);
  if (!value?.library || !Array.isArray(value.library.videos) || !value.cachedAt) return null;
  return value;
}

export async function writeLibraryCache(library: VideoLibrary, cachedAt = new Date().toISOString()) {
  await kvSet(LIBRARY_KEY, { library, cachedAt } satisfies CachedLibrary);
}

export async function readDoneCache(): Promise<DoneList | null> {
  return kvGet<DoneList>(DONE_KEY);
}

export async function writeDoneCache(done: DoneList) {
  await kvSet(DONE_KEY, done);
}

export async function readQueueCache(): Promise<Queue | null> {
  return kvGet<Queue>(QUEUE_KEY);
}

export async function writeQueueCache(queue: Queue) {
  await kvSet(QUEUE_KEY, queue);
}

export async function readPendingActions(): Promise<PendingAction[]> {
  const value = await kvGet<PendingAction[]>(ACTIONS_KEY);
  return compactActions(Array.isArray(value) ? value : []);
}

export async function writePendingActions(actions: PendingAction[]) {
  await kvSet(ACTIONS_KEY, compactActions(actions));
}

export async function enqueuePendingAction(
  incoming: { kind: PendingAction["kind"]; op: object; clientId?: string },
): Promise<PendingAction[]> {
  const next = enqueueAction(await readPendingActions(), incoming);
  await writePendingActions(next);
  return next;
}

export async function flushPendingActions(senders: {
  sendDone: (op: object) => Promise<unknown>;
  sendQueue: (op: object) => Promise<unknown>;
}) {
  const current = await readPendingActions();
  if (current.length === 0) {
    return { remaining: [] as PendingAction[], sent: 0, results: {}, error: undefined as unknown };
  }
  const result = await flushActions(current, senders);
  // Keep anything enqueued while this flush was in flight, plus unsent ops.
  const latest = await readPendingActions();
  const unsent = new Set(result.remaining.map((action) => action.clientId));
  const flushed = new Set(current.map((action) => action.clientId));
  const keep = compactActions(
    latest.filter((action) => unsent.has(action.clientId) || !flushed.has(action.clientId)),
  );
  await writePendingActions(keep);
  return { ...result, remaining: keep };
}

export async function pendingActionCount(): Promise<number> {
  return (await readPendingActions()).length;
}
