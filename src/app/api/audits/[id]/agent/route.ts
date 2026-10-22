import { NextResponse } from "next/server";
import { agentBudgetPlan, normalizeLimits } from "@/lib/agent-core.mjs";
import { emptyTrace, runAgent } from "@/lib/agent";
import { openRun, quotaRefusal, startRun } from "@/lib/http-guard";
import { createNdjsonStream } from "@/lib/ndjson-stream.mjs";
import { runWithDeadline } from "@/lib/run-deadline.mjs";
import { getTestModels, missingKeys } from "@/lib/providers";
import { findAudit, updateAudit, writeRaw } from "@/lib/storage";
import type { AgentEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Streams the agent loop as NDJSON (start, step, tool, stop, done | error).
// Guarded like the audit route: run token, JSON only, quota, then keys, then one run at a time.
// Budgets in the body are clamped to the server's caps (TASTEPROBE_AGENT_MAX_*).
export async function POST(request: Request, context: { params: { id: string } }) {
  const opened = openRun(request);
  if (opened.refusal) return opened.refusal;
  const { policy, ip } = opened;
  const quota = quotaRefusal(ip, policy);
  if (quota) return quota;
  const missing = missingKeys();
  if (missing.length) return NextResponse.json({ error: "setup_required", missing, message: missing.map((name) => `Setup required: ${name}`).join("; ") }, { status: 503 });
  const audit = await findAudit(context.params.id);
  if (!audit) return NextResponse.json({ error: "Audit not found." }, { status: 404 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const segment = typeof body.segment === "string"
    ? audit.segments.find((item) => item.id === body.segment)
    : [...audit.segments].sort((a, b) => a.share - b.share)[0];
  if (!segment) return NextResponse.json({ error: "That taste segment is not part of this audit." }, { status: 400 });
  const limits = normalizeLimits(body, policy.agentCaps);
  // A cap that leaves the search no persona to test is refused here, before a run is spent.
  const personaIds = audit.personas.filter((persona) => persona.segment === segment.name).map((persona) => persona.id);
  const budgetPlan = agentBudgetPlan(personaIds, getTestModels().length, limits);
  if (budgetPlan.tooSmall) {
    return NextResponse.json({
      error: `An assistant-call cap of ${limits.maxAssistantCalls} is too small for this segment: the confirmation probe and one search persona need at least ${budgetPlan.minAssistantCalls}. Nothing ran.`,
      code: "budget_too_small", minAssistantCalls: budgetPlan.minAssistantCalls,
    }, { status: 400 });
  }
  const slot = startRun(ip, policy, "agent");
  if ("refusal" in slot) return slot.refusal;

  // The run continues and is saved even if the client disconnects; see ndjson-stream.mjs.
  const trace = emptyTrace();
  const { stream } = createNdjsonStream<AgentEvent>(async (send) => {
    try {
      const { run } = await runWithDeadline(slot.signal, () => runAgent(audit, segment, limits, send, trace));
      await writeRaw(audit.id, `agent-${run.id}`, { run, trace });
      await updateAudit(audit.id, (current) => { current.agentRuns = [...(current.agentRuns ?? []), run]; });
      send({ type: "done", run });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent loop failed.";
      await writeRaw(audit.id, `agent-failed-${Date.now()}`, { error: message, trace }).catch(() => undefined);
      throw error;
    }
  }, {
    onError: (error) => ({ type: "error", message: error instanceof Error ? error.message : "Agent loop failed." }),
    onSettled: () => slot.release(),
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
