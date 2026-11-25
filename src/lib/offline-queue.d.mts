export type ActionKind = "done" | "queue" | "downloaded";

export interface PendingAction {
  clientId: string;
  kind: ActionKind;
  op: object;
  queuedAt: string;
}

export function isRetriableStatus(status: unknown): boolean;
export function isRetriableError(error: unknown): boolean;
export function compactActions(actions: PendingAction[]): PendingAction[];
export function enqueueAction(
  actions: PendingAction[],
  incoming: { kind: ActionKind; op: object; queuedAt?: string; clientId?: string },
  now?: string,
): PendingAction[];
export function flushActions(
  actions: PendingAction[],
  senders: {
    sendDone: (op: object) => Promise<unknown>;
    sendQueue: (op: object) => Promise<unknown>;
    sendDownloaded?: (op: object) => Promise<unknown>;
  },
): Promise<{
  remaining: PendingAction[];
  sent: number;
  results: { done?: unknown; queue?: unknown; downloaded?: unknown };
  error?: unknown;
}>;
