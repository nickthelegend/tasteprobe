// Wall-clock deadline for one audit, fix or agent run (TASTEPROBE_RUN_DEADLINE_SECONDS, default
// 900). The run gate (run-guard.mjs) owns an AbortController per run, aborts it with a
// RunDeadlineError when the deadline passes and frees the run slot at the same moment. Code inside
// the run reads the signal through AsyncLocalStorage, so provider calls and the pool and agent
// loops stop without threading a signal through every function:
//   - runSignal() is passed to each fetch / OpenAI request;
//   - untilDeadline(promise) settles with the deadline error even if a call ignores its signal;
//   - throwIfDeadline() runs between pool items and agent turns.
import { AsyncLocalStorage } from "node:async_hooks";

export class RunDeadlineError extends Error {
  constructor(kind, seconds) {
    super(`Deadline: the ${kind} run stopped after ${seconds} s (TASTEPROBE_RUN_DEADLINE_SECONDS). Answers already paid for are kept in the server's audit store under raw/<audit id>/, marked complete: false; the run slot is free again.`);
    this.name = "RunDeadlineError";
    this.code = "deadline";
  }
}

// The deadline message with the audit id the partial answers are stored under.
export function deadlineMessage(error, auditId) {
  return auditId ? `${error.message} Audit id: ${auditId}.` : error.message;
}

const store = new AsyncLocalStorage();

// Runs `fn` with `signal` as the current run's deadline signal.
export function runWithDeadline(signal, fn) {
  return store.run(signal, fn);
}

// The current run's signal, or undefined outside a gated run (CLI, MCP, tests).
export function runSignal() {
  return store.getStore();
}

export function throwIfDeadline() {
  const signal = runSignal();
  if (signal?.aborted) throw signal.reason;
}

// True when an error was caused by the run's deadline (so a catch that records provider failures
// must rethrow it instead of saving it as one more failed call).
export function deadlinePassed() {
  return Boolean(runSignal()?.aborted);
}

// Settles with the deadline error as soon as the run's signal aborts, whatever `promise` does.
export function untilDeadline(promise) {
  const signal = runSignal();
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  let onAbort;
  const aborted = new Promise((_, reject) => { onAbort = () => reject(signal.reason); signal.addEventListener("abort", onAbort, { once: true }); });
  return Promise.race([promise, aborted]).finally(() => signal.removeEventListener("abort", onAbort));
}

// A fetch signal: the per-request timeout, plus the run's deadline when there is one.
export function requestSignal(timeoutMs) {
  const signal = runSignal();
  return signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs);
}

// Bounded-concurrency map. Checks the deadline before each item, so a run past its deadline
// starts no new work.
export async function pool(values, concurrency, task) {
  const output = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      throwIfDeadline();
      const index = cursor++;
      output[index] = await untilDeadline(task(values[index], index));
    }
  }));
  return output;
}
