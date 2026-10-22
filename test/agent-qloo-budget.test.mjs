// The agent's qloo_insights tool is budgeted: at most one call per turn and at most
// TASTEPROBE_AGENT_MAX_QLOO_CALLS (default 12) live Qloo calls per run, counted in the budget the
// step events carry. Nemotron and Qloo are replaced by in-test stand-ins passed through runAgent's
// `deps` (test/ only); no provider is called and no key is set.
import assert from "node:assert/strict";
import test from "node:test";
import { createBudget, qlooCallCap } from "../src/lib/agent-core.mjs";
import { runAgent } from "../src/lib/agent.ts";

const personas = Array.from({ length: 8 }, (_, index) => ({ id: `p${index}`, segment: "Music taste", segmentId: "s1", affinities: [] }));
const audit = {
  id: "a1", brand: "Test Venue", qlooEntityId: "Q1", category: "restaurant", city: "Mumbai", personas, rivalChecks: [],
  segments: [{ id: "s1", name: "Music taste", share: 0.1, ci: [0, 0.3], competitors: [] }],
};
const segment = audit.segments[0];
const limits = { maxTries: 3, maxAssistantCalls: 1000, maxUsd: null, maxNemotronTokens: 5_000_000, maxTurns: 40 };
const usage = { inputTokens: 10, outputTokens: 10 };
const call = (index, location) => ({ id: `t${index}`, type: "function", function: { name: "qloo_insights", arguments: JSON.stringify({ filter_type: "urn:entity:artist", location }) } });

function harness(turns) {
  let turn = 0;
  const profileCalls = [];
  const events = [];
  const deps = {
    nemotronTurn: async () => {
      const toolCalls = turns(turn++);
      return { model: "test", message: { role: "assistant", content: "", tool_calls: toolCalls.length ? toolCalls : undefined }, usage, finishReason: "stop", reasoning: "" };
    },
    qlooTasteProfile: async ({ location }) => { profileCalls.push(location); return { items: [{ name: `Artist in ${location}`, affinity: 0.9 }], raw: {} }; },
  };
  return { deps, profileCalls, events, send: (event) => events.push(event) };
}

test("the Qloo call cap defaults to 12 and reads TASTEPROBE_AGENT_MAX_QLOO_CALLS", () => {
  assert.equal(qlooCallCap({}), 12);
  assert.equal(qlooCallCap({ TASTEPROBE_AGENT_MAX_QLOO_CALLS: "3" }), 3);
  assert.equal(qlooCallCap({ TASTEPROBE_AGENT_MAX_QLOO_CALLS: "0" }), 1);
  assert.equal(createBudget().qlooCalls, 0);
});

test("30 qloo_insights calls in one turn: one runs, the rest are rejected", async () => {
  const run = harness((turn) => turn === 0 ? Array.from({ length: 30 }, (_, index) => call(index, `City ${index}`)) : []);
  await runAgent(audit, segment, limits, run.send, undefined, run.deps);
  assert.equal(run.profileCalls.length, 1);
  const rejected = run.events.filter((event) => event.type === "tool" && !event.ok);
  assert.equal(rejected.length, 29);
  assert.match(rejected[0].summary, /^Rejected: one qloo_insights call per turn/);
});

test("one new city a turn: Qloo is called at most the cap, then 'Rejected: Qloo call budget spent'", async () => {
  const previous = process.env.TASTEPROBE_AGENT_MAX_QLOO_CALLS;
  delete process.env.TASTEPROBE_AGENT_MAX_QLOO_CALLS;
  try {
    const run = harness((turn) => turn < 30 ? [call(turn, `City ${turn}`)] : []);
    const { run: result } = await runAgent(audit, segment, limits, run.send, undefined, run.deps);
    assert.equal(run.profileCalls.length, 12);
    const tools = run.events.filter((event) => event.type === "tool");
    assert.equal(tools.filter((event) => event.ok).length, 12);
    assert.match(tools[12].summary, /^Rejected: Qloo call budget spent \(12 per run\)/);
    assert.equal(result.budget.qlooCalls, 12);
    const steps = run.events.filter((event) => event.type === "step");
    assert.equal(steps.at(-1).budget.qlooCalls, 12, "step events carry the Qloo count");
  } finally {
    if (previous !== undefined) process.env.TASTEPROBE_AGENT_MAX_QLOO_CALLS = previous;
  }
});
