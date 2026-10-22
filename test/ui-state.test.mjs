// The tasting room's race rules (src/lib/ui-state.mjs): a slow fix, agent or audit answer never
// lands on an audit the user has switched away from, and only one run happens at a time.
import assert from "node:assert/strict";
import test from "node:test";
import { latestOnly, mergeIfCurrent, roomControls } from "../src/lib/ui-state.mjs";

test("a fix that finishes after the user switched audits does not pull the view back", () => {
  const a = { id: "a", counterfactuals: [] };
  const b = { id: "b", counterfactuals: [] };
  const aWithFix = { id: "a", counterfactuals: [{ id: "f1" }] };
  // The old code did setActive({ ...activeWhenTheFixStarted, counterfactuals: [...] }): the view jumped back to a.
  assert.equal(mergeIfCurrent(b, "a", aWithFix), b);
  assert.equal(mergeIfCurrent(a, "a", aWithFix), aWithFix);
  assert.equal(mergeIfCurrent(null, "a", aWithFix), null);
});

test("one run at a time: fix and agent cannot run together, and the audit cannot change mid-run", () => {
  const idle = roomControls({ ready: true, pouring: false, fixing: false, agentRunning: false });
  assert.deepEqual(idle, { canRunAudit: true, canFix: true, canRunAgent: true, canSwitchAudit: true });
  for (const busy of [{ pouring: true }, { fixing: true }, { agentRunning: true }]) {
    const state = roomControls({ ready: true, pouring: false, fixing: false, agentRunning: false, ...busy });
    assert.deepEqual(state, { canRunAudit: false, canFix: false, canRunAgent: false, canSwitchAudit: false }, JSON.stringify(busy));
  }
  assert.deepEqual(roomControls({ ready: false, pouring: false, fixing: false, agentRunning: false }), { canRunAudit: false, canFix: false, canRunAgent: false, canSwitchAudit: true });
});

test("opening audits: a slower earlier answer is aborted and ignored", () => {
  const opens = latestOnly();
  const first = opens.start();
  const second = opens.start();
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);
  assert.equal(opens.isLatest(first.token), false);
  assert.equal(opens.isLatest(second.token), true);
  opens.abort();
  assert.equal(second.signal.aborted, true);
  assert.equal(opens.isLatest(second.token), false);
});
