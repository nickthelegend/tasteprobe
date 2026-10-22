// Wall-clock deadline for audit, fix and agent runs: the gate aborts the run's signal and frees the
// one run slot when TASTEPROBE_RUN_DEADLINE_SECONDS passes, and every provider call and pool step
// inside the run stops. The "provider" below is a promise that never settles, standing in for a
// stuck upstream; nothing here calls a real API.
import assert from "node:assert/strict";
import test from "node:test";
import { pool, RunDeadlineError, runWithDeadline, throwIfDeadline, untilDeadline } from "../src/lib/run-deadline.mjs";
import { publicPolicy, RunGate, runPolicy } from "../src/lib/run-guard.mjs";

test("the deadline defaults to 900 s, is configurable, and is published", () => {
  assert.equal(runPolicy({}).deadlineSeconds, 900);
  assert.equal(runPolicy({ TASTEPROBE_RUN_DEADLINE_SECONDS: "60" }).deadlineSeconds, 60);
  assert.equal(runPolicy({ TASTEPROBE_RUN_DEADLINE_SECONDS: "0" }).deadlineSeconds, 1);
  assert.equal(publicPolicy(runPolicy({})).deadlineSeconds, 900);
});

test("a run whose provider never answers settles with a deadline error and frees the slot", async () => {
  const gate = new RunGate();
  const policy = { ...runPolicy({}), deadlineMs: 60 };
  const slot = gate.start("1.1.1.1", policy, "audit");
  assert.equal(gate.running.kind, "audit");
  const stuck = () => untilDeadline(new Promise(() => {}));
  await assert.rejects(runWithDeadline(slot.signal, () => pool([1, 2, 3, 4, 5, 6], 2, stuck)), (error) => {
    assert.ok(error instanceof RunDeadlineError);
    assert.match(error.message, /^Deadline: the audit run stopped after 0\.06 s \(TASTEPROBE_RUN_DEADLINE_SECONDS\)/);
    return true;
  });
  assert.equal(gate.running, null, "the slot is free once the deadline passes");
  assert.equal(typeof gate.start("2.2.2.2", policy, "fix").release, "function", "the next run can start");
});

test("the pool stops starting work after the deadline; finished runs clear their timer", async () => {
  const gate = new RunGate();
  const slot = gate.start("1.1.1.1", { ...runPolicy({}), deadlineMs: 50 }, "agent");
  let started = 0;
  const slow = async () => { started++; await new Promise((resolve) => setTimeout(resolve, 30)); };
  await assert.rejects(runWithDeadline(slot.signal, () => pool(Array.from({ length: 20 }, (_, index) => index), 1, slow)), RunDeadlineError);
  assert.ok(started < 5, `${started} tasks started before the deadline stopped the pool`);
  // Outside a run nothing is aborted, and a run that finishes in time keeps its result.
  throwIfDeadline();
  assert.equal(await untilDeadline(Promise.resolve(7)), 7);
  const quick = new RunGate().start("1.1.1.1", runPolicy({}), "audit");
  assert.deepEqual(await runWithDeadline(quick.signal, () => pool([1, 2], 2, async (value) => value * 2)), [2, 4]);
  quick.release();
  assert.equal(quick.signal.aborted, false);
});
