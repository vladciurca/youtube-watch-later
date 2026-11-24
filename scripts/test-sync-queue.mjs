import assert from "node:assert/strict";
import {
  compactActions,
  enqueueAction,
  flushActions,
  isRetriableError,
  isRetriableStatus,
} from "../src/lib/offline-queue.mjs";

const A = "aaaaaaaaaaa";
const B = "bbbbbbbbbbb";
const C = "ccccccccccc";
const T = "2026-11-24T15:00:00.000Z";

function act(kind, op, clientId) {
  return { clientId, kind, op, queuedAt: T };
}

// last Done/undone per video wins
assert.deepEqual(
  compactActions([
    act("done", { type: "done", id: A }, "1"),
    act("done", { type: "undone", id: A }, "2"),
    act("done", { type: "done", id: B }, "3"),
    act("done", { type: "done", id: A }, "4"),
  ]).map((item) => [item.op.type, item.op.id]),
  [
    ["done", B],
    ["done", A],
  ],
);

// undone after done on the same id collapses to undone
assert.deepEqual(
  compactActions([
    act("done", { type: "done", id: A }, "1"),
    act("done", { type: "undone", id: A }, "2"),
  ]).map((item) => item.op.type),
  ["undone"],
);

// a later reorder drops earlier moves/reorders, but keeps add/remove
assert.deepEqual(
  compactActions([
    act("queue", { type: "add", id: A }, "1"),
    act("queue", { type: "top", id: A }, "2"),
    act("queue", { type: "up", id: B }, "3"),
    act("queue", { type: "reorder", ids: [A, B, C] }, "4"),
    act("queue", { type: "remove", id: C }, "5"),
  ]).map((item) => item.op.type),
  ["add", "reorder", "remove"],
);

// moves stay when there is no later reorder
assert.deepEqual(
  compactActions([
    act("queue", { type: "add", id: A }, "1"),
    act("queue", { type: "top", id: A }, "2"),
  ]).map((item) => item.op.type),
  ["add", "top"],
);

// earlier reorder is dropped in favor of the last one
assert.deepEqual(
  compactActions([
    act("queue", { type: "reorder", ids: [A, B] }, "1"),
    act("queue", { type: "reorder", ids: [B, A] }, "2"),
  ]).map((item) => item.op.ids),
  [[B, A]],
);

// exact consecutive duplicates collapse
assert.deepEqual(
  compactActions([
    act("queue", { type: "add", id: A }, "1"),
    act("queue", { type: "add", id: A }, "2"),
  ]).map((item) => item.clientId),
  ["1"],
);

// remove then add is kept (add-after-remove appends; a bare add would no-op)
assert.deepEqual(
  compactActions([
    act("queue", { type: "remove", id: A }, "1"),
    act("queue", { type: "add", id: A }, "2"),
  ]).map((item) => item.op.type),
  ["remove", "add"],
);

// Done and Queue ops keep relative order after compacting
assert.deepEqual(
  compactActions([
    act("queue", { type: "add", id: A }, "1"),
    act("done", { type: "done", id: A }, "2"),
    act("queue", { type: "remove", id: A }, "3"),
    act("done", { type: "undone", id: A }, "4"),
  ]).map((item) => [item.kind, item.op.type]),
  [
    ["queue", "add"],
    ["queue", "remove"],
    ["done", "undone"],
  ],
);

// enqueue assigns an id and compacts
const queued = enqueueAction([], { kind: "done", op: { type: "done", id: A } }, T);
assert.equal(queued.length, 1);
assert.equal(queued[0].kind, "done");
assert.ok(queued[0].clientId);
const queued2 = enqueueAction(
  queued,
  { kind: "done", op: { type: "undone", id: A }, clientId: "x" },
  T,
);
assert.equal(queued2.length, 1);
assert.equal(queued2[0].op.type, "undone");
assert.equal(queued2[0].clientId, "x");
assert.deepEqual(enqueueAction(queued, { kind: "nope", op: { type: "done", id: A } }, T), queued);
assert.deepEqual(compactActions(null), []);
assert.deepEqual(compactActions([]), []);

// flush: success clears the queue and records the last server snapshot
{
  const sent = [];
  const result = await flushActions(
    [
      act("done", { type: "done", id: A }, "1"),
      act("queue", { type: "add", id: B }, "2"),
    ],
    {
      sendDone: async (op) => {
        sent.push(["done", op.id]);
        return { ids: [op.id] };
      },
      sendQueue: async (op) => {
        sent.push(["queue", op.id]);
        return { ids: [op.id] };
      },
    },
  );
  assert.deepEqual(sent, [
    ["done", A],
    ["queue", B],
  ]);
  assert.equal(result.sent, 2);
  assert.deepEqual(result.remaining, []);
  assert.deepEqual(result.results.done, { ids: [A] });
  assert.deepEqual(result.results.queue, { ids: [B] });
  assert.equal(result.error, undefined);
}

// flush: a retriable error keeps that op and everything after it
{
  const sent = [];
  const boom = Object.assign(new Error("Network error"), { retriable: true });
  const result = await flushActions(
    [
      act("done", { type: "done", id: A }, "1"),
      act("done", { type: "done", id: B }, "2"),
      act("queue", { type: "add", id: C }, "3"),
    ],
    {
      sendDone: async (op) => {
        sent.push(op.id);
        if (op.id === B) throw boom;
        return { ok: true };
      },
      sendQueue: async () => {
        throw new Error("should not be called");
      },
    },
  );
  assert.deepEqual(sent, [A, B]);
  assert.equal(result.sent, 1);
  assert.equal(result.error, boom);
  assert.deepEqual(
    result.remaining.map((item) => item.op.id),
    [B, C],
  );
}

// flush: a permanent 404 is dropped and later ops still run (no duplicates / no blockage)
{
  const sent = [];
  const missing = Object.assign(new Error("Video is not in the library (404)"), {
    retriable: false,
    status: 404,
  });
  const result = await flushActions(
    [
      act("done", { type: "done", id: A }, "1"),
      act("queue", { type: "add", id: B }, "2"),
    ],
    {
      sendDone: async () => {
        throw missing;
      },
      sendQueue: async (op) => {
        sent.push(op.id);
        return { ids: [op.id] };
      },
    },
  );
  assert.deepEqual(sent, [B]);
  assert.equal(result.sent, 1);
  assert.deepEqual(result.remaining, []);
  assert.equal(result.error, undefined);
}

// flush: compacting before send means done+undone on the same id is one call
{
  const sent = [];
  const result = await flushActions(
    [
      act("done", { type: "done", id: A }, "1"),
      act("done", { type: "undone", id: A }, "2"),
      act("done", { type: "done", id: A }, "3"),
    ],
    {
      sendDone: async (op) => {
        sent.push(op.type);
        return { ok: true };
      },
      sendQueue: async () => ({}),
    },
  );
  assert.deepEqual(sent, ["done"]);
  assert.equal(result.sent, 1);
  assert.deepEqual(result.remaining, []);
}

assert.equal(isRetriableStatus(429), true);
assert.equal(isRetriableStatus(503), true);
assert.equal(isRetriableStatus(404), false);
assert.equal(isRetriableStatus(409), false);
assert.equal(isRetriableError(Object.assign(new Error("no"), { retriable: false, status: 404 })), false);
assert.equal(isRetriableError(Object.assign(new Error("no"), { status: 404 })), false);
assert.equal(isRetriableError(Object.assign(new Error("no"), { status: 503 })), true);
assert.equal(isRetriableError(new Error("Failed to fetch")), true);
assert.equal(isRetriableError(new Error("Could not save (503)")), true);
assert.equal(isRetriableError(new Error("Could not save (409)")), false);
assert.equal(isRetriableStatus(401), true);
assert.equal(isRetriableStatus(403), true);
assert.equal(isRetriableStatus(400), false);

// Downloaded: last op per video wins, like Done
assert.deepEqual(
  compactActions([
    act("downloaded", { type: "downloaded", id: A }, "d1"),
    act("downloaded", { type: "undownloaded", id: A }, "d2"),
    act("downloaded", { type: "downloaded", id: B }, "d3"),
    act("downloaded", { type: "downloaded", id: A }, "d4"),
  ]).map((item) => [item.op.type, item.op.id]),
  [
    ["downloaded", B],
    ["downloaded", A],
  ],
);
assert.deepEqual(
  compactActions([
    act("downloaded", { type: "downloaded", id: A }, "d1"),
    act("downloaded", { type: "undownloaded", id: A }, "d2"),
  ]).map((item) => item.op.type),
  ["undownloaded"],
);

// Downloaded and Done keep relative order after compacting each kind
assert.deepEqual(
  compactActions([
    act("downloaded", { type: "downloaded", id: A }, "1"),
    act("done", { type: "done", id: A }, "2"),
    act("downloaded", { type: "undownloaded", id: A }, "3"),
  ]).map((item) => [item.kind, item.op.type]),
  [
    ["done", "done"],
    ["downloaded", "undownloaded"],
  ],
);

const dlQueued = enqueueAction([], { kind: "downloaded", op: { type: "downloaded", id: A } }, T);
assert.equal(dlQueued.length, 1);
assert.equal(dlQueued[0].kind, "downloaded");
assert.deepEqual(
  enqueueAction(dlQueued, { kind: "downloaded", op: { type: "undownloaded", id: A }, clientId: "dx" }, T).map(
    (item) => [item.clientId, item.op.type],
  ),
  [["dx", "undownloaded"]],
);

// flush: compacting downloaded+undownloaded+downloaded is one call
{
  const sent = [];
  const result = await flushActions(
    [
      act("downloaded", { type: "downloaded", id: A }, "1"),
      act("downloaded", { type: "undownloaded", id: A }, "2"),
      act("downloaded", { type: "downloaded", id: A }, "3"),
    ],
    {
      sendDone: async () => ({}),
      sendQueue: async () => ({}),
      sendDownloaded: async (op) => {
        sent.push(op.type);
        return { ids: [A] };
      },
    },
  );
  assert.deepEqual(sent, ["downloaded"]);
  assert.equal(result.sent, 1);
  assert.deepEqual(result.remaining, []);
  assert.deepEqual(result.results.downloaded, { ids: [A] });
}

// flush: a retriable downloaded error keeps later ops
{
  const boom = Object.assign(new Error("Network error"), { retriable: true });
  const result = await flushActions(
    [
      act("downloaded", { type: "downloaded", id: A }, "1"),
      act("done", { type: "done", id: B }, "2"),
    ],
    {
      sendDone: async () => {
        throw new Error("should not be called");
      },
      sendQueue: async () => ({}),
      sendDownloaded: async () => {
        throw boom;
      },
    },
  );
  assert.equal(result.sent, 0);
  assert.equal(result.error, boom);
  assert.deepEqual(
    result.remaining.map((item) => item.kind),
    ["downloaded", "done"],
  );
}

console.log("test-sync-queue: ok");
