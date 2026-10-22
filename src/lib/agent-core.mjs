// Pure pieces of the fix-agent loop: budget accounting, the stop rule, copy validation and
// best-candidate selection. No network here, so all of it is unit-tested directly.
import { HACKATHON_ENTITY_TYPES } from "./persona-source.mjs";
import { pairedBootstrapDifference, shareInterval, shareOf } from "./stats.mjs";
import { MIN_PERSONAS_PER_SEGMENT } from "./taste.mjs";

export const DEFAULT_LIMITS = Object.freeze({
  maxTries: 3,            // copies the agent may propose
  maxAssistantCalls: 120, // calls to the assistants under test (placebo + fix arms)
  maxUsd: null,           // Nemotron spend cap; needs NEBIUS_*_PRICE_PER_MILLION to be enforced
  maxNemotronTokens: 400_000,
  maxTurns: 12,           // agent reasoning turns
});

// Server-side caps a request is clamped to (see run-guard.mjs): the UI's maxima by default.
export const DEFAULT_CAPS = Object.freeze({ maxTries: 5, maxAssistantCalls: 480, maxNemotronTokens: 400_000, maxTurns: 20 });

// Client values are clamped to the hard bounds and then to `caps`, so a request body can lower a
// budget but never raise it past what the server allows.
export function normalizeLimits(input = {}, caps = DEFAULT_CAPS) {
  const pick = (value, fallback, min, max, cap) => {
    const number = Number(value);
    const chosen = value === undefined || value === null || value === "" || !Number.isFinite(number) ? fallback : Math.min(max, Math.max(min, Math.floor(number)));
    return Math.max(min, Math.min(chosen, cap ?? max));
  };
  const usd = Number(input.maxUsd);
  return {
    maxTries: pick(input.maxTries, DEFAULT_LIMITS.maxTries, 1, 8, caps.maxTries),
    maxAssistantCalls: pick(input.maxAssistantCalls, DEFAULT_LIMITS.maxAssistantCalls, 4, 1000, caps.maxAssistantCalls),
    maxUsd: input.maxUsd === undefined || input.maxUsd === null || input.maxUsd === "" || !Number.isFinite(usd) || usd <= 0 ? null : usd,
    maxNemotronTokens: pick(input.maxNemotronTokens, DEFAULT_LIMITS.maxNemotronTokens, 10_000, 5_000_000, caps.maxNemotronTokens),
    maxTurns: pick(input.maxTurns, DEFAULT_LIMITS.maxTurns, 2, 40, caps.maxTurns),
  };
}

export function createBudget() {
  return { tries: 0, turns: 0, assistantCalls: 0, nemotronCalls: 0, qlooCalls: 0, inputTokens: 0, outputTokens: 0, usd: 0, priced: true };
}

// Live Qloo calls the agent's qloo_insights tool may make in one run (TASTEPROBE_AGENT_MAX_QLOO_CALLS).
// Each distinct (type, entity, location) is a new call, so the model could otherwise loop on cities.
export const DEFAULT_QLOO_CALLS = 12;
export function qlooCallCap(env = {}) {
  const raw = env.TASTEPROBE_AGENT_MAX_QLOO_CALLS;
  if (raw === undefined || raw === null || String(raw).trim() === "") return DEFAULT_QLOO_CALLS;
  const number = Math.floor(Number(raw));
  return Number.isFinite(number) ? Math.min(50, Math.max(1, number)) : DEFAULT_QLOO_CALLS;
}

export function tokenCostUsd(usage, prices) {
  if (!prices || !Number.isFinite(prices.input) || !Number.isFinite(prices.output)) return null;
  return (usage.inputTokens * prices.input + usage.outputTokens * prices.output) / 1_000_000;
}

// Returns a new budget with the spend added. Cost is only known when prices are configured;
// once any charge is unpriced, `priced` stays false and the dollar cap cannot be enforced.
export function chargeBudget(budget, { assistantCalls = 0, nemotronCalls = 0, qlooCalls = 0, usage = { inputTokens: 0, outputTokens: 0 }, tries = 0, turns = 0 }, prices) {
  const cost = tokenCostUsd(usage, prices);
  const hasTokens = usage.inputTokens + usage.outputTokens > 0;
  return {
    tries: budget.tries + tries,
    turns: budget.turns + turns,
    assistantCalls: budget.assistantCalls + assistantCalls,
    nemotronCalls: budget.nemotronCalls + nemotronCalls,
    qlooCalls: (budget.qlooCalls ?? 0) + qlooCalls,
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
// These are nominal intervals: picking the best of several copies after several looks is a screen,
// not a test (see stopDecision).
export function selectBest(candidates) {
  const scored = candidates.map((candidate) => ({ candidate, stats: candidateStats(candidate) })).filter((item) => item.stats.liftCi);
  scored.sort((a, b) => b.stats.liftCi[0] - a.stats.liftCi[0] || b.stats.lift - a.stats.lift || b.stats.personas - a.stats.personas);
  return scored[0] ?? null;
}

// Why a search-phase interval alone cannot end the run: the agent looks at the interval after every
// probe (optional stopping) across up to maxTries copies (multiple comparisons). A seeded null
// simulation (scripts/null-sim.mjs) puts the false "lift above zero" rate of that rule at 8.9-16.4% at 3 copies,
// against a nominal 2.5%. So the search only SCREENS. A copy that clears the screen gets ONE
// confirmation probe on personas the search never used (held-out personas when the segment has
// at least 16; otherwise a fresh re-ask of the same personas, whose answers are new draws), and
// only that confirmation's interval can declare a win. One confirmation per run, then the run stops.

// Splits a segment's personas into the search's selection set and the confirmation set.
export function planConfirmation(personaIds) {
  const count = personaIds.length;
  if (count >= 2 * MIN_PERSONAS_PER_SEGMENT) {
    const held = Math.max(MIN_PERSONAS_PER_SEGMENT, Math.floor(count / 3));
    return { mode: "holdout", selection: personaIds.slice(0, count - held), confirmation: personaIds.slice(count - held) };
  }
  return { mode: "rerun", selection: [...personaIds], confirmation: [...personaIds] };
}

// Assistant calls the confirmation probe needs (placebo + fix for every confirmation persona). The
// search may not spend them, so a screened copy can always be confirmed.
export function confirmationCalls(plan, assistants) {
  return plan.confirmation.length * Math.max(1, assistants) * 2;
}

// The budget split for a run: the confirmation's calls come off the top, and the search must be able
// to afford at least one persona (placebo + fix on every assistant). When it cannot, the run is
// refused before it starts (budget_too_small) with the smallest cap that would work.
export function agentBudgetPlan(personaIds, assistants, limits) {
  const plan = planConfirmation(personaIds);
  const reserved = confirmationCalls(plan, assistants);
  const perPersona = Math.max(1, assistants) * 2;
  const searchLimits = { ...limits, maxAssistantCalls: Math.max(0, limits.maxAssistantCalls - reserved) };
  const minAssistantCalls = reserved + perPersona;
  return { plan, confirmationCalls: reserved, searchLimits, minAssistantCalls, tooSmall: limits.maxAssistantCalls < minAssistantCalls };
}

// The best candidate if it clears the screen: probed on at least 8 selection personas (or the whole
// selection when it is smaller) with a nominal 95% lift interval entirely above zero.
export function screenedCandidate(candidates, selectionSize) {
  const best = selectBest(candidates);
  return best && best.stats.personas >= Math.min(MIN_PERSONAS_PER_SEGMENT, selectionSize) && best.stats.liftCi[0] > 0 ? best : null;
}

// The confirmation probe's verdict: passed only if its own nominal 95% lift interval is above zero.
export function confirmationResult({ candidateId, mode, placeboRows, fixRows, failed = 0 }) {
  const stats = candidateStats({ placeboRows, fixRows, personasProbed: [...new Set([...placeboRows, ...fixRows].map((row) => row.personaId))], failed });
  return {
    candidateId, mode, personas: stats.personas, placeboShare: stats.placeboShare, fixShare: stats.fixShare,
    lift: stats.lift, liftCi: stats.liftCi, failed, passed: Boolean(stats.liftCi && stats.liftCi[0] > 0),
  };
}

// What the loop does next. `limits` are the SEARCH limits (the confirmation's calls already taken
// out). After the confirmation the run stops either way; a screened copy asks for the confirmation;
// otherwise the run stops when any budget dimension runs out or every allowed copy is fully probed.
export function stopDecision(candidates, budget, limits, selectionSize, confirmation = null) {
  if (confirmation) return { stop: true, reason: confirmation.passed ? "lift_confirmed" : "confirmation_failed", confirm: null };
  const screened = screenedCandidate(candidates, selectionSize);
  if (screened) return { stop: false, reason: null, confirm: screened.candidate.id };
  const exhausted = budgetExhausted(budget, limits);
  if (exhausted) return { stop: true, reason: exhausted, confirm: null };
  if (budget.tries >= limits.maxTries && candidates.length && candidates.every((candidate) => candidate.personasProbed.length >= selectionSize)) {
    return { stop: true, reason: "budget_tries", confirm: null };
  }
  return { stop: false, reason: null, confirm: null };
}

export const STOP_REASONS = {
  lift_confirmed: "A copy cleared the screen, then beat the placebo again on a confirmation probe the search never used: its nominal 95% lift interval is above zero.",
  confirmation_failed: "A copy cleared the screen, but its confirmation probe's lift interval included zero, so no win is declared.",
  budget_assistant_calls: "The assistant-call budget for the search is spent.",
  budget_nemotron_tokens: "The Nemotron token budget is spent.",
  budget_usd: "The dollar cap on Nemotron spend was reached.",
  budget_turns: "The agent used all of its reasoning turns.",
  budget_tries: "Every allowed copy was proposed and probed on the whole selection set without clearing the screen.",
  agent_finished: "The agent ended the loop without a copy that cleared the screen.",
  budget_too_small: "The assistant-call cap is too small for this segment: after the confirmation probe's calls are set aside, the search could not test one persona. Nothing ran.",
};

// Personas a probe should use next for this candidate: ones it has not asked yet, in segment order.
export function nextPersonas(segmentPersonaIds, probedIds, count) {
  const used = new Set(probedIds);
  return segmentPersonaIds.filter((id) => !used.has(id)).slice(0, Math.max(0, count));
}

// filter.type values the agent's qloo_insights tool (and the MCP qloo_taste_profile tool) may ask
// for. The hackathon host supports only urn:entity types (urn:tag answers 403 there), so urn:tag
// is offered only against another Qloo host.
export function qlooFilterTypes(hackathonHost) {
  const entityTypes = HACKATHON_ENTITY_TYPES.map((type) => `urn:entity:${type}`);
  return hackathonHost ? entityTypes : ["urn:tag", ...entityTypes];
}

// Validates qloo_insights arguments. No filter_type = the segment's own persona signals (urn:tag,
// or urn:entity after a 403), as before. `entity` is "venue" or the Qloo id of a rival this audit
// verified in Qloo; `location` defaults to the venue's city.
export function validateQlooToolArgs(args = {}, { rivals = [], hackathonHost = true, city }) {
  const allowedTypes = qlooFilterTypes(hackathonHost);
  const filterType = args.filter_type === undefined || args.filter_type === null || args.filter_type === "" ? null : String(args.filter_type);
  if (filterType !== null && !allowedTypes.includes(filterType)) {
    const hint = filterType === "urn:tag" && hackathonHost ? "urn:tag is not supported on the Qloo hackathon host (it answers 403). " : "";
    return { ok: false, error: `${hint}filter_type must be one of: ${allowedTypes.join(", ")}.` };
  }
  const entity = args.entity === undefined || args.entity === null || args.entity === "" ? "venue" : String(args.entity);
  const rival = rivals.find((item) => item.qlooId === entity || item.name === entity);
  if (entity !== "venue" && !rival) {
    return { ok: false, error: `entity must be "venue" or the Qloo id of a verified rival: ${rivals.length ? rivals.map((item) => `${item.qlooId} (${item.name})`).join(", ") : "this audit has no verified rivals"}.` };
  }
  if (args.location !== undefined && args.location !== null && (typeof args.location !== "string" || args.location.trim().length < 2 || args.location.trim().length > 80)) {
    return { ok: false, error: "location must be a city name of 2 to 80 characters." };
  }
  const location = typeof args.location === "string" && args.location.trim() ? args.location.trim() : city;
  return { ok: true, value: { filterType, entity: rival ? { kind: "rival", id: rival.qlooId, name: rival.name } : { kind: "venue" }, location } };
}
