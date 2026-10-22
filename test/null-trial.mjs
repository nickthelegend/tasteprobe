// The seeded null-simulation trial shared by test/agent.test.mjs and scripts/null-sim.mjs. Not a
// test file itself (node --test runs test/*.test.mjs only). Pure: no I/O, no network.
import {
  affordablePersonas, candidateStats, chargeBudget, confirmationCalls, confirmationResult, createBudget,
  nextPersonas, normalizeLimits, planConfirmation, stopDecision,
} from "../src/lib/agent-core.mjs";
import { seededRandom } from "../src/lib/stats.mjs";

// Null simulation: the copy has NO effect (fix and placebo share each persona's rate). The agent
// policy follows the README (probe 8 at a time, keep probing while the point lift is positive,
// otherwise revise) under the default limits (120 assistant calls; 3 copies unless `maxTries` says otherwise). Seeded, so the rates
// below are exact for this code. The old rule stopped on the search interval and is reported as
// `screened`; the new rule needs the confirmation probe as well.
export function nullTrial(seed, segmentSize, assistants, maxTries = 3) {
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
  const limits = normalizeLimits({ maxTries });
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

// Rates over `runs` seeded trials for one configuration: `screen` is how often the search interval
// alone cleared zero (the old stop rule), `confirmed` how often the confirmation also passed.
export function nullRates({ segmentSize, assistants, maxTries, runs, seed = 5000 }) {
  let screened = 0, confirmed = 0;
  for (let trial = 0; trial < runs; trial++) {
    const outcome = nullTrial(seed + trial, segmentSize, assistants, maxTries);
    if (outcome.screened) screened++;
    if (outcome.confirmed) confirmed++;
  }
  return { screen: screened / runs, confirmed: confirmed / runs };
}
