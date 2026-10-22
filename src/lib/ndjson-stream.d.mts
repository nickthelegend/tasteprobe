export const HEARTBEAT_MS: number;
export type StreamOutcome = { ok: true } | { ok: false; error: unknown };
export function createNdjsonStream<E>(
  task: (send: (event: E | { type: "heartbeat"; at: string }) => boolean) => Promise<unknown>,
  options?: { heartbeatMs?: number; onError?: (error: unknown) => E; onSettled?: (outcome: StreamOutcome) => void },
): { stream: ReadableStream<Uint8Array>; done: Promise<StreamOutcome>; isOpen: () => boolean };
