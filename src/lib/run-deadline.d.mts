export function deadlineMessage(error: Error, auditId: string | null): string;
export class RunDeadlineError extends Error {
  constructor(kind: string, seconds: number);
  code: "deadline";
}
export function runWithDeadline<T>(signal: AbortSignal, fn: () => T): T;
export function runSignal(): AbortSignal | undefined;
export function throwIfDeadline(): void;
export function deadlinePassed(): boolean;
export function untilDeadline<T>(promise: Promise<T>): Promise<T>;
export function requestSignal(timeoutMs: number): AbortSignal;
export function pool<T, R>(values: T[], concurrency: number, task: (value: T, index: number) => Promise<R>): Promise<R[]>;
