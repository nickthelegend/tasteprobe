import { NextResponse } from "next/server";
import { findFixTarget, FixLookupError, runFix } from "@/lib/fix";
import { openRun, quotaRefusal, startRun } from "@/lib/http-guard";
import { ConfigError, requireKeys } from "@/lib/providers";
import { RunDeadlineError, runWithDeadline } from "@/lib/run-deadline.mjs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request, context: { params: { id: string } }) {
  const opened = openRun(request);
  if (opened.refusal) return opened.refusal;
  const { policy, ip } = opened;
  const body = await request.json().catch(() => ({})) as { segment?: string };
  const quota = quotaRefusal(ip, policy);
  if (quota) return quota;
  const segmentId = typeof body.segment === "string" ? body.segment : undefined;
  // Look the audit and segment up before spending a run: a bad id answers 404/400 for free.
  try { await findFixTarget(context.params.id, segmentId); }
  catch (error) {
    if (error instanceof FixLookupError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  try { requireKeys(); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Setup required." }, { status: 503 }); }
  const slot = startRun(ip, policy, "fix");
  if ("refusal" in slot) return slot.refusal;
  try {
    return NextResponse.json(await runWithDeadline(slot.signal, () => runFix(context.params.id, segmentId)));
  } catch (error) {
    const status = error instanceof ConfigError ? 503 : error instanceof FixLookupError ? error.status : error instanceof RunDeadlineError ? 504 : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Counterfactual re-test failed." }, { status });
  } finally {
    slot.release();
  }
}
