import { NextResponse } from "next/server";
import { FixLookupError, runFix } from "@/lib/fix";
import { openRun, quotaRefusal, startRun } from "@/lib/http-guard";
import { ConfigError, requireKeys } from "@/lib/providers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request, context: { params: { id: string } }) {
  const opened = openRun(request);
  if (opened.refusal) return opened.refusal;
  const { policy, ip } = opened;
  const body = await request.json().catch(() => ({})) as { segment?: string };
  const quota = quotaRefusal(ip, policy);
  if (quota) return quota;
  try { requireKeys(); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Setup required." }, { status: 503 }); }
  const slot = startRun(ip, policy, "fix");
  if ("refusal" in slot) return slot.refusal;
  try {
    return NextResponse.json(await runFix(context.params.id, typeof body.segment === "string" ? body.segment : undefined));
  } catch (error) {
    const status = error instanceof ConfigError ? 503 : error instanceof FixLookupError ? error.status : 502;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Counterfactual re-test failed." }, { status });
  } finally {
    slot.release();
  }
}
