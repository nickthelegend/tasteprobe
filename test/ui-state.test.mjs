// The tasting room's race rules (src/lib/ui-state.mjs): a slow fix, agent or audit answer never
// lands on an audit the user has switched away from, and only one run happens at a time.
import assert from "node:assert/strict";
import test from "node:test";
import { agentChoices, latestOnly, mergeIfCurrent, roomControls } from "../src/lib/ui-state.mjs";

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

test("agent budget selects: the shown and the sent values are the same, clamped to the server caps and the segment's minimum", () => {
  const ids = (count) => Array.from({ length: count }, (_, index) => `p${index}`);
  // Server caps 2 copies / 100 calls: the defaults (3, 120) are not offered, so the largest allowed are used.
  const capped = agentChoices({ caps: { maxTries: 2, maxAssistantCalls: 100 }, personaIds: ids(8), assistants: 1, tries: 3, calls: 120 });
  assert.deepEqual([capped.tryOptions, capped.callOptions, capped.tries, capped.calls], [[1, 2], [48], 2, 48]);
  // 24 personas x 3 assistants: 48 calls leave the search nothing (minimum 54), so 48 is not offered.
  const big = agentChoices({ caps: { maxTries: 5, maxAssistantCalls: 480 }, personaIds: ids(24), assistants: 3, tries: 3, calls: 48 });
  assert.deepEqual([big.callOptions, big.calls, big.minAssistantCalls], [[120, 240, 480], 120, 54]);
  // Nothing fits: no option, no value, and the minimum to explain.
  const none = agentChoices({ caps: { maxTries: 5, maxAssistantCalls: 60 }, personaIds: ids(24), assistants: 3, tries: 3, calls: 120 });
  assert.deepEqual([none.callOptions, none.calls, none.minAssistantCalls], [[], null, 54]);
  // No caps known yet: the UI's own options.
  const open = agentChoices({ personaIds: ids(8), assistants: 1, tries: 3, calls: 120 });
  assert.deepEqual([open.tryOptions, open.callOptions, open.tries, open.calls], [[1, 2, 3, 5], [48, 120, 240, 480], 3, 120]);
});
