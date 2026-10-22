import assert from "node:assert/strict";
import test from "node:test";
import {
  affordablePersonas, budgetExhausted, candidateStats, chargeBudget, createBudget, DEFAULT_LIMITS, nextPersonas,
  normalizeLimits, parseToolArguments, selectBest, stopDecision, tokenCostUsd, validateCopy,
} from "../src/lib/agent-core.mjs";

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

test("stop rule: lift CI above zero on enough personas, else budget, else keep going", () => {
  const budget = createBudget();
  assert.deepEqual(stopDecision([candidate("c1", 1, 7)], budget, limits, 16), { stop: true, reason: "lift_ci_above_zero" });
  // Same effect on only 4 personas is not enough evidence to stop.
  assert.equal(stopDecision([candidate("c1", 0, 4, 4)], budget, limits, 16).stop, false);
  assert.deepEqual(stopDecision([candidate("c1", 3, 3)], budget, limits, 16), { stop: false, reason: null });
  assert.equal(stopDecision([candidate("c1", 3, 3)], { ...budget, assistantCalls: 96 }, limits, 16).reason, "budget_assistant_calls");
  const spent = { ...budget, tries: 3 };
  assert.equal(stopDecision([candidate("c1", 3, 3, 8)], spent, limits, 8).reason, "budget_tries");
  assert.equal(stopDecision([candidate("c1", 3, 3, 8)], spent, limits, 16).stop, false);
});
