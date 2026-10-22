// Rules the tasting room follows so a slow answer never lands on the wrong audit. Pure, so they
// are unit-tested directly; src/app/page.tsx applies them.

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
