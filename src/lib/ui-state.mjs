// Rules the tasting room follows so a slow answer never lands on the wrong audit. Pure, so they
// are unit-tested directly; src/app/page.tsx applies them.
import { agentBudgetPlan, normalizeLimits } from "./agent-core.mjs";

export const AGENT_TRY_OPTIONS = [1, 2, 3, 5];
export const AGENT_CALL_OPTIONS = [48, 120, 240, 480];

// The kept value if it is offered, else the largest option at or below it, else the smallest.
const nearest = (options, value) => options.includes(value) ? value : ([...options].reverse().find((option) => option <= value) ?? options[0] ?? null);

// The agent loop's budget selects. Options are the UI's choices within the server caps; call caps
// also have to cover the confirmation probe plus one search persona for this segment. The value
// shown is the value sent: a state the options no longer include is clamped, never sent as-is.
export function agentChoices({ caps, personaIds, assistants, tries, calls }) {
  const tryOptions = AGENT_TRY_OPTIONS.filter((value) => value <= (caps?.maxTries ?? Infinity));
  const minAssistantCalls = agentBudgetPlan(personaIds, assistants, normalizeLimits({ maxAssistantCalls: 1000 }, { maxTries: 8, maxAssistantCalls: 1000, maxNemotronTokens: 5_000_000, maxTurns: 40 })).minAssistantCalls;
  const callOptions = AGENT_CALL_OPTIONS.filter((value) => value <= (caps?.maxAssistantCalls ?? Infinity) && value >= minAssistantCalls);
  return { tryOptions, callOptions, tries: nearest(tryOptions, tries), calls: nearest(callOptions, calls), minAssistantCalls };
}

// A finished fix or agent run (or a re-read audit) replaces the shown audit only if the user is
// still looking at that audit; otherwise the shown one stays.
export function mergeIfCurrent(shown, auditId, fresh) {
  return shown && shown.id === auditId ? fresh : shown;
}

// One thing at a time: while an audit pours, a fix re-pours or the agent runs, nothing else can
// start and the selected audit cannot change.
export function roomControls({ ready, pouring, fixing, agentRunning }) {
  const busy = Boolean(pouring || fixing || agentRunning);
  return { canRunAudit: Boolean(ready) && !busy, canFix: Boolean(ready) && !busy, canRunAgent: Boolean(ready) && !busy, canSwitchAudit: !busy };
}

// Tracks the latest request of one kind (opening an audit): start() returns a token and aborts
// the previous request's signal; isLatest(token) says whether an answer is still wanted.
export function latestOnly() {
  let current = 0;
  let controller = null;
  return {
    start() {
      controller?.abort();
      controller = new AbortController();
      current += 1;
      return { token: current, signal: controller.signal };
    },
    isLatest(token) { return token === current; },
    abort() { controller?.abort(); current += 1; },
  };
}
