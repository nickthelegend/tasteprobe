import assert from "node:assert/strict";
import test from "node:test";
import {
  affordablePersonas, agentBudgetPlan, budgetExhausted, candidateStats, chargeBudget, confirmationCalls, confirmationResult, createBudget, DEFAULT_LIMITS,
  nextPersonas, normalizeLimits, parseToolArguments, planConfirmation, screenedCandidate, selectBest, stopDecision,
  STOP_REASONS, tokenCostUsd, validateCopy,
} from "../src/lib/agent-core.mjs";
import { seededRandom } from "../src/lib/stats.mjs";
import { nullTrial } from "./null-trial.mjs";

const limits = normalizeLimits({ maxTries: 3, maxAssistantCalls: 96, maxUsd: 0.05, maxNemotronTokens: 100_000, maxTurns: 10 });
const prices = { input: 0.06, output: 0.24 };

// rows for `personas` personas × 2 assistants, with `hits` personas recommending the brand.
function rows(personas, hits, offset = 0) {
  const out = [];
  for (let index = 0; index < personas; index++) for (let model = 0; model < 2; model++) out.push({ personaId: `p${index + offset}`, brand: index < hits });
  return out;
}
function candidate(id, placeboHits, fixHits, personas = 8) {
  return { id, copy: `copy ${id}`, rationale: "", placeboRows: rows(personas, placeboHits), fixRows: rows(personas, fixHits), personasProbed: Array.from({ length: personas }, (_, index) => `p${index}`), failed: 0 };
}

test("limits are clamped and defaulted", () => {
  assert.deepEqual(normalizeLimits(), { ...DEFAULT_LIMITS });
  const clamped = normalizeLimits({ maxTries: 99, maxAssistantCalls: 1, maxUsd: "-2", maxTurns: "abc" });
  assert.equal(clamped.maxTries, 5, "the server cap (the UI's maximum), not the client's 99");
  assert.equal(clamped.maxAssistantCalls, 4);
  assert.equal(clamped.maxUsd, null);
  assert.equal(clamped.maxTurns, DEFAULT_LIMITS.maxTurns);
  // With caps above the hard bounds, the hard bounds still hold.
  const loose = normalizeLimits({ maxTries: 99, maxAssistantCalls: 99_999, maxNemotronTokens: 1e9, maxTurns: 99 }, { maxTries: 99, maxAssistantCalls: 99_999, maxNemotronTokens: 1e9, maxTurns: 99 });
  assert.deepEqual([loose.maxTries, loose.maxAssistantCalls, loose.maxNemotronTokens, loose.maxTurns], [8, 1000, 5_000_000, 40]);
});

test("budget accounting adds calls, tokens and cost; unpriced usage disables the dollar cap", () => {
  let budget = chargeBudget(createBudget(), { nemotronCalls: 1, turns: 1, usage: { inputTokens: 1_000_000, outputTokens: 0 } }, prices);
  assert.equal(budget.usd, 0.06);
  assert.equal(budget.priced, true);
  budget = chargeBudget(budget, { assistantCalls: 16, tries: 1 }, prices);
  assert.equal(budget.assistantCalls, 16);
  assert.equal(budget.tries, 1);
  assert.equal(budgetExhausted(budget, { ...limits, maxNemotronTokens: 5_000_000 }), "budget_usd");
  const unpriced = chargeBudget(createBudget(), { usage: { inputTokens: 2_000_000, outputTokens: 0 } }, null);
  assert.equal(unpriced.priced, false);
  assert.equal(tokenCostUsd({ inputTokens: 10, outputTokens: 10 }, null), null);
  assert.notEqual(budgetExhausted(unpriced, { ...limits, maxNemotronTokens: 5_000_000 }), "budget_usd");
});

test("every budget dimension can end the run", () => {
  const base = createBudget();
  assert.equal(budgetExhausted(base, limits), null);
  assert.equal(budgetExhausted({ ...base, assistantCalls: 96 }, limits), "budget_assistant_calls");
  assert.equal(budgetExhausted({ ...base, inputTokens: 60_000, outputTokens: 40_000 }, limits), "budget_nemotron_tokens");
  assert.equal(budgetExhausted({ ...base, turns: 10 }, limits), "budget_turns");
});

test("probes are trimmed to what the assistant-call budget can pay for", () => {
  assert.equal(affordablePersonas(createBudget(), limits, 8, 2), 8);
  assert.equal(affordablePersonas({ ...createBudget(), assistantCalls: 80 }, limits, 8, 2), 4);
  assert.equal(affordablePersonas({ ...createBudget(), assistantCalls: 95 }, limits, 8, 2), 0);
  assert.deepEqual(nextPersonas(["p1", "p2", "p3", "p4"], ["p2"], 2), ["p1", "p3"]);
  assert.deepEqual(nextPersonas(["p1"], ["p1"], 3), []);
});

test("copy validation enforces the published rules", () => {
  assert.equal(validateCopy("Late-night small plates and a vinyl-only playlist for people who come for the music."), null);
  assert.match(validateCopy(""), /non-empty/);
  assert.match(validateCopy(Array.from({ length: 46 }, () => "word").join(" ")), /46 words/);
  assert.match(validateCopy("Voted best in Mumbai"), /prices, awards or rankings/);
  assert.match(validateCopy("Cocktails from $9"), /prices/);
});

test("tool arguments parse safely", () => {
  assert.deepEqual(parseToolArguments('{"n":8}'), { ok: true, value: { n: 8 } });
  assert.deepEqual(parseToolArguments(""), { ok: true, value: {} });
  assert.equal(parseToolArguments("{oops").ok, false);
  assert.equal(parseToolArguments("[1]").ok, false);
});

test("candidate stats use placebo vs fix on the same personas", () => {
  const stats = candidateStats(candidate("c1", 1, 6));
  assert.equal(stats.personas, 8);
  assert.equal(stats.placeboShare, 1 / 8);
  assert.equal(stats.fixShare, 6 / 8);
  assert.ok(stats.liftCi[0] > 0);
  const unprobed = candidateStats({ id: "c2", copy: "x", rationale: "", placeboRows: [], fixRows: [], personasProbed: [], failed: 0 });
  assert.equal(unprobed.liftCi, null);
});

test("best candidate has the highest lower bound, then the larger point lift", () => {
  const weak = candidate("weak", 2, 3);
  const strong = candidate("strong", 1, 7);
  const unprobed = { id: "new", copy: "x", rationale: "", placeboRows: [], fixRows: [], personasProbed: [], failed: 0 };
  assert.equal(selectBest([weak, strong, unprobed]).candidate.id, "strong");
  assert.equal(selectBest([unprobed]), null);
  assert.equal(selectBest([]), null);
});

test("stop rule: a search interval above zero only screens; one confirmation decides; else budget, else keep going", () => {
  const budget = createBudget();
  // Screened: the loop must run the confirmation, it may not stop on the search interval.
  assert.deepEqual(stopDecision([candidate("c1", 1, 7)], budget, limits, 16), { stop: false, reason: null, confirm: "c1" });
  assert.equal(screenedCandidate([candidate("c1", 1, 7)], 16).candidate.id, "c1");
  // Same effect on only 4 personas does not even clear the screen.
  assert.equal(stopDecision([candidate("c1", 0, 4, 4)], budget, limits, 16).stop, false);
  assert.equal(stopDecision([candidate("c1", 0, 4, 4)], budget, limits, 16).confirm, null);
  assert.deepEqual(stopDecision([candidate("c1", 3, 3)], budget, limits, 16), { stop: false, reason: null, confirm: null });
  assert.equal(stopDecision([candidate("c1", 3, 3)], { ...budget, assistantCalls: 96 }, limits, 16).reason, "budget_assistant_calls");
  const spent = { ...budget, tries: 3 };
  assert.equal(stopDecision([candidate("c1", 3, 3, 8)], spent, limits, 8).reason, "budget_tries");
  assert.equal(stopDecision([candidate("c1", 3, 3, 8)], spent, limits, 16).stop, false);
  // After the confirmation the run stops either way, and only a passed confirmation is a win.
  const passed = confirmationResult({ candidateId: "c1", mode: "holdout", placeboRows: rows(8, 1, 100), fixRows: rows(8, 7, 100) });
  assert.equal(passed.passed, true);
  assert.equal(passed.personas, 8);
  assert.deepEqual(stopDecision([candidate("c1", 1, 7)], budget, limits, 16, passed), { stop: true, reason: "lift_confirmed", confirm: null });
  const failed = confirmationResult({ candidateId: "c1", mode: "holdout", placeboRows: rows(8, 3, 100), fixRows: rows(8, 3, 100) });
  assert.equal(failed.passed, false);
  assert.deepEqual(stopDecision([candidate("c1", 1, 7)], budget, limits, 16, failed), { stop: true, reason: "confirmation_failed", confirm: null });
  // A segment under 16 personas re-asks the same personas: a pass is "lift_reconfirmed", never
  // described as personas the search never used.
  const reasked = confirmationResult({ candidateId: "c1", mode: "rerun", placeboRows: rows(8, 1, 100), fixRows: rows(8, 7, 100) });
  assert.equal(reasked.passed, true);
  assert.deepEqual(stopDecision([candidate("c1", 1, 7)], budget, limits, 8, reasked), { stop: true, reason: "lift_reconfirmed", confirm: null });
  assert.match(STOP_REASONS.lift_confirmed, /held-out personas the search never used/);
  assert.match(STOP_REASONS.lift_reconfirmed, /same personas were re-asked/);
  assert.doesNotMatch(STOP_REASONS.lift_reconfirmed, /never used/);
  const failedReask = confirmationResult({ candidateId: "c1", mode: "rerun", placeboRows: rows(8, 3, 100), fixRows: rows(8, 3, 100) });
  assert.equal(stopDecision([candidate("c1", 1, 7)], budget, limits, 8, failedReask).reason, "confirmation_failed");
});

test("at the public demo's cap (24 personas, so 3 segments of 8) every confirmation is a re-ask; 96 personas give held-out ones", async () => {
  const { maxSegmentsFor } = await import("../src/lib/taste.mjs");
  const ids = (count) => Array.from({ length: count }, (_, index) => `p${index}`);
  assert.equal(maxSegmentsFor(24), 3);
  assert.equal(planConfirmation(ids(24 / maxSegmentsFor(24))).mode, "rerun");
  assert.equal(planConfirmation(ids(96 / maxSegmentsFor(96))).mode, "holdout");
});

test("confirmation plan: held-out personas from 16 up, a fresh re-ask below; its calls are reserved", () => {
  const ids = (count) => Array.from({ length: count }, (_, index) => `p${index}`);
  assert.deepEqual(planConfirmation(ids(8)), { mode: "rerun", selection: ids(8), confirmation: ids(8) });
  const sixteen = planConfirmation(ids(16));
  assert.equal(sixteen.mode, "holdout");
  assert.deepEqual([sixteen.selection.length, sixteen.confirmation.length], [8, 8]);
  assert.equal(sixteen.selection.filter((id) => sixteen.confirmation.includes(id)).length, 0, "held-out personas are never searched");
  const big = planConfirmation(ids(33));
  assert.deepEqual([big.selection.length, big.confirmation.length], [22, 11]);
  assert.equal(confirmationCalls(sixteen, 2), 32);
  assert.equal(confirmationCalls(planConfirmation(ids(8)), 1), 16);
});

test("a cap that leaves the search no budget is refused up front (budget_too_small), never reported as spent", () => {
  const ids = (count) => Array.from({ length: count }, (_, index) => `p${index}`);
  // (personas, assistants) at the UI's smallest 48-call option: the confirmation alone takes 48+.
  for (const [personas, assistants, confirmation, minimum] of [[12, 3, 72, 78], [24, 3, 48, 54], [15, 2, 60, 64]]) {
    const plan = agentBudgetPlan(ids(personas), assistants, normalizeLimits({ maxAssistantCalls: 48 }));
    assert.equal(plan.confirmationCalls, confirmation, `${personas}x${assistants} confirmation`);
    assert.equal(plan.minAssistantCalls, minimum, `${personas}x${assistants} minimum = confirmation + one search persona`);
    assert.equal(plan.tooSmall, true);
    assert.ok(plan.searchLimits.maxAssistantCalls < 2 * assistants);
  }
  const roomy = agentBudgetPlan(ids(24), 3, normalizeLimits({ maxAssistantCalls: 120 }));
  assert.equal(roomy.tooSmall, false);
  assert.equal(roomy.searchLimits.maxAssistantCalls, 72);
  assert.equal(budgetExhausted(createBudget(), roomy.searchLimits), null, "a run that starts can afford a probe");
  assert.equal(affordablePersonas(createBudget(), roomy.searchLimits, 8, 3), 8);
  assert.match(STOP_REASONS.budget_too_small, /too small/);
});

test("null simulation: the confirmed rule keeps false wins at or under 5%, the search interval alone does not", { timeout: 120_000 }, () => {
  const trials = 800;
  for (const [segmentSize, assistants] of [[8, 2], [16, 1]]) {
    let screened = 0, confirmed = 0;
    for (let trial = 0; trial < trials; trial++) {
      const outcome = nullTrial(5000 + trial, segmentSize, assistants);
      if (outcome.screened) screened++;
      if (outcome.confirmed) confirmed++;
    }
    const screenRate = screened / trials, winRate = confirmed / trials;
    assert.ok(screenRate > 0.05, `segment ${segmentSize}, ${assistants} assistant(s): the search interval alone 'won' ${(screenRate * 100).toFixed(1)}% of null runs; expected well above 5%`);
    assert.ok(winRate <= 0.05, `segment ${segmentSize}, ${assistants} assistant(s): false confirmed wins ${(winRate * 100).toFixed(1)}% of null runs; must be <= 5%`);
  }
});

// The server cap and the room allow up to 5 copies (TASTEPROBE_AGENT_MAX_TRIES default), so the
// guarantee is checked there too: more copies mean more looks for the screen, not for the result.
test("null simulation at 5 copies, the most the server allows: confirmed false wins stay at or under 5%", { timeout: 120_000 }, () => {
  assert.equal(normalizeLimits({ maxTries: 5 }).maxTries, 5);
  const trials = 800;
  for (const [segmentSize, assistants] of [[8, 2], [16, 1], [24, 2]]) {
    let screened = 0, confirmed = 0;
    for (let trial = 0; trial < trials; trial++) {
      const outcome = nullTrial(9000 + trial, segmentSize, assistants, 5);
      if (outcome.screened) screened++;
      if (outcome.confirmed) confirmed++;
    }
    assert.ok(screened / trials > 0.05, `segment ${segmentSize} x ${assistants}, 5 copies: the screen alone 'won' ${(100 * screened / trials).toFixed(1)}%`);
    assert.ok(confirmed / trials <= 0.05, `segment ${segmentSize} x ${assistants}, 5 copies: false confirmed wins ${(100 * confirmed / trials).toFixed(1)}%; must be <= 5%`);
  }
});

test("qloo_insights arguments: supported urn:entity types only on the hackathon host, venue or a verified rival, a city", async () => {
  const { validateQlooToolArgs, qlooFilterTypes } = await import("../src/lib/agent-core.mjs");
  const rivals = [{ name: "Rival One", qlooId: "Q-RIVAL-1" }];
  const context = { rivals, hackathonHost: true, city: "Mumbai" };
  assert.deepEqual(validateQlooToolArgs({}, context), { ok: true, value: { filterType: null, entity: { kind: "venue" }, location: "Mumbai" } });
  assert.deepEqual(validateQlooToolArgs({ filter_type: "urn:entity:artist", entity: "Q-RIVAL-1", location: "Pune" }, context),
    { ok: true, value: { filterType: "urn:entity:artist", entity: { kind: "rival", id: "Q-RIVAL-1", name: "Rival One" }, location: "Pune" } });
  const tag = validateQlooToolArgs({ filter_type: "urn:tag" }, context);
  assert.equal(tag.ok, false);
  assert.match(tag.error, /^urn:tag is not supported on the Qloo hackathon host \(it answers 403\)/);
  assert.equal(validateQlooToolArgs({ filter_type: "urn:tag" }, { ...context, hackathonHost: false }).ok, true);
  assert.match(validateQlooToolArgs({ filter_type: "urn:entity:restaurant" }, context).error, /filter_type must be one of: urn:entity:artist, urn:entity:book/);
  assert.match(validateQlooToolArgs({ entity: "Q-UNKNOWN" }, context).error, /entity must be "venue" or the Qloo id of a verified rival: Q-RIVAL-1 \(Rival One\)/);
  assert.match(validateQlooToolArgs({ location: "x" }, context).error, /location must be a city name/);
  assert.deepEqual(qlooFilterTypes(true), ["urn:entity:artist", "urn:entity:book", "urn:entity:brand", "urn:entity:destination", "urn:entity:movie", "urn:entity:person", "urn:entity:place", "urn:entity:podcast", "urn:entity:tv_show", "urn:entity:video_game"]);
});

test("the agent's qloo_insights tool schema offers the supported types and the verified rivals", async () => {
  const { buildAgentTools } = await import("../src/lib/agent.ts");
  const tools = buildAgentTools({ rivals: [{ name: "Rival One", qlooId: "Q-RIVAL-1" }], hackathonHost: true });
  const qloo = tools.find((tool) => tool.function.name === "qloo_insights").function;
  assert.deepEqual(Object.keys(qloo.parameters.properties), ["filter_type", "entity", "location"]);
  assert.ok(!qloo.parameters.properties.filter_type.enum.includes("urn:tag"));
  assert.equal(qloo.parameters.properties.filter_type.enum.length, 10);
  assert.match(qloo.parameters.properties.entity.description, /Q-RIVAL-1 = Rival One/);
  assert.deepEqual(tools.map((tool) => tool.function.name), ["qloo_insights", "propose_copy", "probe_segment", "get_stats"]);
  const production = buildAgentTools({ rivals: [], hackathonHost: false }).find((tool) => tool.function.name === "qloo_insights").function;
  assert.equal(production.parameters.properties.filter_type.enum[0], "urn:tag");
});
