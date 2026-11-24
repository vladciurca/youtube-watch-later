// Offline action queue: Done and Queue ops made without a network are stored
// locally and flushed later. The server ops are already idempotent; compacting
// here just avoids sending work that a later op has already superseded.

/**
 * @typedef {'done' | 'queue'} ActionKind
 * @typedef {{ clientId: string, kind: ActionKind, op: object, queuedAt: string }} PendingAction
 */

export function isRetriableStatus(status) {
  if (typeof status !== "number") return false;
  // Validation / "not in library" / "already Done" should not block the queue.
  if (status === 400 || status === 404 || status === 409) return false;
  return status === 429 || status >= 400;
}

export function isRetriableError(error) {
  if (!error || typeof error !== "object") return true;
  if (error.retriable === true) return true;
  if (error.retriable === false) return false;
  if (typeof error.status === "number") return isRetriableStatus(error.status);
  const message = typeof error.message === "string" ? error.message : "";
  if (/network|failed to fetch|load failed|offline/i.test(message)) return true;
  if (/\((4\d\d)\)/.test(message)) {
    const status = Number(RegExp.$1);
    return isRetriableStatus(status);
  }
  if (/\((5\d\d)\)/.test(message)) return true;
  return true;
}

function sameOp(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  return JSON.stringify(a.op) === JSON.stringify(b.op);
}

/**
 * Drop Done ops superseded by a later Done/undone on the same video, drop
 * Queue moves superseded by a later reorder, and drop exact consecutive
 * duplicates. Membership ops (add/remove) are kept in order so a later
 * reorder cannot resurrect a removed id on the server.
 *
 * @param {PendingAction[]} actions
 * @returns {PendingAction[]}
 */
export function compactActions(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return [];
  const list = actions.filter((action) => action && (action.kind === "done" || action.kind === "queue"));

  const lastDoneAt = new Map();
  let lastReorderAt = -1;
  for (let i = 0; i < list.length; i++) {
    const action = list[i];
    if (action.kind === "done" && action.op?.id) lastDoneAt.set(action.op.id, i);
    if (action.kind === "queue" && action.op?.type === "reorder") lastReorderAt = i;
  }

  const out = [];
  for (let i = 0; i < list.length; i++) {
    const action = list[i];
    if (action.kind === "done") {
      if (!action.op?.id) continue;
      if (lastDoneAt.get(action.op.id) !== i) continue;
    } else if (action.op?.type === "top" || action.op?.type === "up" || action.op?.type === "down") {
      if (lastReorderAt > i) continue;
    } else if (action.op?.type === "reorder") {
      if (lastReorderAt !== i) continue;
    }
    const prev = out[out.length - 1];
    if (prev && sameOp(prev, action)) continue;
    out.push(action);
  }
  return out;
}

/**
 * Append an action and compact. `clientId` is preserved when provided so a
 * retry of the same queued item does not mint a duplicate id.
 *
 * @param {PendingAction[]} actions
 * @param {{ kind: ActionKind, op: object, queuedAt?: string, clientId?: string }} incoming
 * @param {string} [now]
 * @returns {PendingAction[]}
 */
export function enqueueAction(actions, incoming, now = new Date().toISOString()) {
  if (!incoming || (incoming.kind !== "done" && incoming.kind !== "queue") || !incoming.op) {
    return compactActions(actions);
  }
  const action = {
    clientId: incoming.clientId || `qa-${now}-${actions.length}-${Math.random().toString(36).slice(2, 10)}`,
    kind: incoming.kind,
    op: incoming.op,
    queuedAt: incoming.queuedAt || now,
  };
  return compactActions([...(Array.isArray(actions) ? actions : []), action]);
}

/**
 * Flush queued actions in order through the provided senders. Stops on the
 * first retriable error and keeps that action plus the rest. Permanent
 * failures (4xx other than 429) are dropped so they cannot block the queue.
 *
 * @param {PendingAction[]} actions
 * @param {{ sendDone: (op: object) => Promise<unknown>, sendQueue: (op: object) => Promise<unknown> }} senders
 * @returns {Promise<{ remaining: PendingAction[], sent: number, results: { done?: unknown, queue?: unknown }, error?: unknown }>}
 */
export async function flushActions(actions, senders) {
  const list = compactActions(actions);
  const remaining = [];
  const results = {};
  let sent = 0;
  let error;

  for (let i = 0; i < list.length; i++) {
    const action = list[i];
    try {
      if (action.kind === "done") {
        results.done = await senders.sendDone(action.op);
      } else {
        results.queue = await senders.sendQueue(action.op);
      }
      sent += 1;
    } catch (err) {
      if (isRetriableError(err)) {
        remaining.push(...list.slice(i));
        error = err;
        break;
      }
      // Permanent failure: skip this op, keep going.
    }
  }

  return { remaining, sent, results, error };
}

