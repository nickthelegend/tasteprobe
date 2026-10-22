import assert from "node:assert/strict";
import test from "node:test";
import {
  affordablePersonas, budgetExhausted, candidateStats, chargeBudget, confirmationCalls, confirmationResult, createBudget, DEFAULT_LIMITS,
  nextPersonas, normalizeLimits, parseToolArguments, planConfirmation, screenedCandidate, selectBest, stopDecision,
  tokenCostUsd, validateCopy,
} from "../src/lib/agent-core.mjs";
import { seededRandom } from "../src/lib/stats.mjs";

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

// Null simulation: the copy has NO effect (fix and placebo share each persona's rate). The agent
// policy follows the README (probe 8 at a time, keep probing while the point lift is positive,
// otherwise revise) under the default limits (3 copies, 120 assistant calls). Seeded, so the rates
// below are exact for this code. The old rule stopped on the search interval and is reported as
// `screened`; the new rule needs the confirmation probe as well.
function nullTrial(seed, segmentSize, assistants) {
  const random = seededRandom(seed);
  const rates = Array.from({ length: segmentSize }, () => Math.min(0.95, Math.max(0.02, 0.3 + (random() - 0.5) * 0.5)));
  const ids = rates.map((_, index) => `p${index}`);
  const draw = (personaIds) => {
    const placeboRows = [], fixRows = [];
    for (const id of personaIds) for (let model = 0; model < assistants; model++) {
      const rate = rates[Number(id.slice(1))];
      placeboRows.push({ personaId: id, brand: random() < rate });
      fixRows.push({ personaId: id, brand: random() < rate });
    }
    return { placeboRows, fixRows };
  };
  const plan = planConfirmation(ids);
  const limits = normalizeLimits({});
  const search = { ...limits, maxAssistantCalls: limits.maxAssistantCalls - confirmationCalls(plan, assistants) };
  const candidates = [];
  let budget = createBudget();
  for (let attempt = 0; attempt < limits.maxTries; attempt++) {
    const current = { id: `c${attempt}`, copy: "x", rationale: "", placeboRows: [], fixRows: [], personasProbed: [], failed: 0 };
    candidates.push(current);
    budget = chargeBudget(budget, { tries: 1 }, null);
    while (current.personasProbed.length < plan.selection.length) {
      const fresh = nextPersonas(plan.selection, current.personasProbed, 8);
      const affordable = affordablePersonas(budget, search, fresh.length, assistants);
      if (!affordable) return { screened: false, confirmed: false };
      const chosen = fresh.slice(0, affordable);
      const probe = draw(chosen);
      current.placeboRows.push(...probe.placeboRows);
      current.fixRows.push(...probe.fixRows);
      current.personasProbed.push(...chosen);
      budget = chargeBudget(budget, { assistantCalls: chosen.length * assistants * 2 }, null);
      const decision = stopDecision(candidates, budget, search, plan.selection.length);
      if (decision.confirm) {
        const confirmation = confirmationResult({ candidateId: decision.confirm, mode: plan.mode, ...draw(plan.confirmation) });
        return { screened: true, confirmed: stopDecision(candidates, budget, search, plan.selection.length, confirmation).reason === "lift_confirmed" };
      }
      if (decision.stop) return { screened: false, confirmed: false };
      if (!(candidateStats(current).lift > 0)) break;
    }
  }
  return { screened: false, confirmed: false };
}

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
