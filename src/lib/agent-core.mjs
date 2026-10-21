// Pure pieces of the fix-agent loop: budget accounting, the stop rule, copy validation and
// best-candidate selection. No network here, so all of it is unit-tested directly.
import { pairedBootstrapDifference, shareInterval, shareOf } from "./stats.mjs";
import { MIN_PERSONAS_PER_SEGMENT } from "./taste.mjs";

export const DEFAULT_LIMITS = Object.freeze({
  maxTries: 3,            // copies the agent may propose
  maxAssistantCalls: 120, // calls to the assistants under test (placebo + fix arms)
  maxUsd: null,           // Nemotron spend cap; needs NEBIUS_*_PRICE_PER_MILLION to be enforced
  maxNemotronTokens: 400_000,
  maxTurns: 12,           // agent reasoning turns
});

export function normalizeLimits(input = {}) {
  const pick = (value, fallback, min, max) => {
    const number = Number(value);
    return value === undefined || value === null || value === "" || !Number.isFinite(number) ? fallback : Math.min(max, Math.max(min, Math.floor(number)));
  };
  const usd = Number(input.maxUsd);
  return {
    maxTries: pick(input.maxTries, DEFAULT_LIMITS.maxTries, 1, 8),
    maxAssistantCalls: pick(input.maxAssistantCalls, DEFAULT_LIMITS.maxAssistantCalls, 4, 1000),
    maxUsd: input.maxUsd === undefined || input.maxUsd === null || input.maxUsd === "" || !Number.isFinite(usd) || usd <= 0 ? null : usd,
    maxNemotronTokens: pick(input.maxNemotronTokens, DEFAULT_LIMITS.maxNemotronTokens, 10_000, 5_000_000),
    maxTurns: pick(input.maxTurns, DEFAULT_LIMITS.maxTurns, 2, 40),
  };
}

export function createBudget() {
  return { tries: 0, turns: 0, assistantCalls: 0, nemotronCalls: 0, inputTokens: 0, outputTokens: 0, usd: 0, priced: true };
}

export function tokenCostUsd(usage, prices) {
  if (!prices || !Number.isFinite(prices.input) || !Number.isFinite(prices.output)) return null;
  return (usage.inputTokens * prices.input + usage.outputTokens * prices.output) / 1_000_000;
}

// Returns a new budget with the spend added. Cost is only known when prices are configured;
// once any charge is unpriced, `priced` stays false and the dollar cap cannot be enforced.
export function chargeBudget(budget, { assistantCalls = 0, nemotronCalls = 0, usage = { inputTokens: 0, outputTokens: 0 }, tries = 0, turns = 0 }, prices) {
  const cost = tokenCostUsd(usage, prices);
  const hasTokens = usage.inputTokens + usage.outputTokens > 0;
  return {
    tries: budget.tries + tries,
    turns: budget.turns + turns,
    assistantCalls: budget.assistantCalls + assistantCalls,
    nemotronCalls: budget.nemotronCalls + nemotronCalls,
    inputTokens: budget.inputTokens + usage.inputTokens,
    outputTokens: budget.outputTokens + usage.outputTokens,
    usd: budget.usd + (cost ?? 0),
    priced: budget.priced && (cost !== null || !hasTokens),
  };
}

export function budgetExhausted(budget, limits) {
  if (budget.assistantCalls >= limits.maxAssistantCalls) return "budget_assistant_calls";
  if (budget.inputTokens + budget.outputTokens >= limits.maxNemotronTokens) return "budget_nemotron_tokens";
  if (limits.maxUsd !== null && budget.priced && budget.usd >= limits.maxUsd) return "budget_usd";
  if (budget.turns >= limits.maxTurns) return "budget_turns";
  return null;
}

// How many personas a probe can still afford: each persona asks every assistant twice (placebo, fix).
export function affordablePersonas(budget, limits, requested, assistants) {
  const perPersona = Math.max(1, assistants) * 2;
  const left = Math.max(0, limits.maxAssistantCalls - budget.assistantCalls);
  return Math.max(0, Math.min(requested, Math.floor(left / perPersona)));
}

const BANNED_CLAIMS = /(\$|₹|€|£|\bprice[sd]?\b|\bcheap(est)?\b|\baward|\bmichelin\b|\bbest in\b|\b#1\b|\bnumber one\b|\branked\b)/i;

// Copy rules from the fix prompt: one non-empty paragraph, at most 45 words, no prices, awards or
// rankings that would need verification. Returns an error message, or null when the copy is usable.
export function validateCopy(copy) {
  if (typeof copy !== "string" || !copy.trim()) return "copy must be a non-empty string";
  const words = copy.trim().split(/\s+/).length;
  if (words > 45) return `copy has ${words} words; the limit is 45`;
  if (BANNED_CLAIMS.test(copy)) return "copy must not mention prices, awards or rankings";
  return null;
}

export function parseToolArguments(raw) {
  if (raw && typeof raw === "object") return { ok: true, value: raw };
  try {
    const value = JSON.parse(String(raw ?? "{}") || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? { ok: true, value } : { ok: false, error: "tool arguments must be a JSON object" };
  } catch {
    return { ok: false, error: `tool arguments are not valid JSON: ${String(raw).slice(0, 120)}` };
  }
}

const clusterRows = (rows) => rows.map((row) => ({ cluster: row.personaId, value: row.brand ? 1 : 0 }));

// Stats for one candidate copy across every probe so far (placebo and fix arms on the same personas).
export function candidateStats(candidate) {
  const placebo = clusterRows(candidate.placeboRows);
  const fix = clusterRows(candidate.fixRows);
  const probed = candidate.personasProbed.length;
  if (!placebo.length || !fix.length) return { personas: probed, placeboShare: null, fixShare: null, lift: null, liftCi: null, placeboCi: null, fixCi: null, failed: candidate.failed };
  return {
    personas: probed,
    placeboShare: shareOf(placebo),
    fixShare: shareOf(fix),
    placeboCi: shareInterval(placebo),
    fixCi: shareInterval(fix),
    lift: shareOf(fix) - shareOf(placebo),
    liftCi: pairedBootstrapDifference(placebo, fix),
    failed: candidate.failed,
  };
}

// Highest lower confidence bound on lift wins; ties go to the larger point lift, then more personas.
export function selectBest(candidates) {
  const scored = candidates.map((candidate) => ({ candidate, stats: candidateStats(candidate) })).filter((item) => item.stats.liftCi);
  scored.sort((a, b) => b.stats.liftCi[0] - a.stats.liftCi[0] || b.stats.lift - a.stats.lift || b.stats.personas - a.stats.personas);
  return scored[0] ?? null;
}

// Stop as soon as a candidate probed on at least 8 personas has a lift interval entirely above
// zero; otherwise stop when any budget dimension runs out or every allowed copy is fully probed.
export function stopDecision(candidates, budget, limits, segmentPersonas) {
  const best = selectBest(candidates);
  if (best && best.stats.personas >= Math.min(MIN_PERSONAS_PER_SEGMENT, segmentPersonas) && best.stats.liftCi[0] > 0) {
    return { stop: true, reason: "lift_ci_above_zero" };
  }
  const exhausted = budgetExhausted(budget, limits);
  if (exhausted) return { stop: true, reason: exhausted };
  if (budget.tries >= limits.maxTries && candidates.length && candidates.every((candidate) => candidate.personasProbed.length >= segmentPersonas)) {
    return { stop: true, reason: "budget_tries" };
  }
  return { stop: false, reason: null };
}

export const STOP_REASONS = {
  lift_ci_above_zero: "A copy's 95% lift interval over the placebo is entirely above zero.",
  budget_assistant_calls: "The assistant-call budget is spent.",
  budget_nemotron_tokens: "The Nemotron token budget is spent.",
  budget_usd: "The dollar cap on Nemotron spend was reached.",
  budget_turns: "The agent used all of its reasoning turns.",
  budget_tries: "Every allowed copy was proposed and probed on the whole segment.",
  agent_finished: "The agent ended the loop without a qualifying copy.",
};

// Personas a probe should use next for this candidate: ones it has not asked yet, in segment order.
export function nextPersonas(segmentPersonaIds, probedIds, count) {
  const used = new Set(probedIds);
  return segmentPersonaIds.filter((id) => !used.has(id)).slice(0, Math.max(0, count));
}
