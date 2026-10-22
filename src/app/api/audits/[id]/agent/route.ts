import { NextResponse } from "next/server";
import { normalizeLimits } from "@/lib/agent-core.mjs";
import { emptyTrace, runAgent } from "@/lib/agent";
import { openRun, quotaRefusal, startRun } from "@/lib/http-guard";
import { missingKeys } from "@/lib/providers";
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
  const slot = startRun(ip, policy, "agent");
  if ("refusal" in slot) return slot.refusal;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: AgentEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const trace = emptyTrace();
      try {
        const { run } = await runAgent(audit, segment, limits, send, trace);
        await writeRaw(audit.id, `agent-${run.id}`, { run, trace });
        await updateAudit(audit.id, (current) => { current.agentRuns = [...(current.agentRuns ?? []), run]; });
        send({ type: "done", run });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Agent loop failed.";
        await writeRaw(audit.id, `agent-failed-${Date.now()}`, { error: message, trace }).catch(() => undefined);
        send({ type: "error", message });
      } finally {
        slot.release();
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
