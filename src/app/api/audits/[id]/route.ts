import { NextResponse } from "next/server";
import type { ArmRun } from "@/lib/experiment";
import type { ResponseRow } from "@/lib/probe";
import { findAudit, readRaw } from "@/lib/storage";

export const dynamic = "force-dynamic";

const trim = (rows: ResponseRow[] = []) => rows.map(({ personaId, segment, model, prompt, answer, entities, brand }) => ({ personaId, segment, model, prompt, answer, entities, brand }));

// Returns the audit plus the cached raw answers (?evidence=1) so every number can be traced to a response.
// ?attempt=<id> picks a fix attempt; the latest one is returned by default.
export async function GET(request: Request, context: { params: { id: string } }) {
  const audit = await findAudit(context.params.id);
  if (!audit) return NextResponse.json({ error: "Audit not found." }, { status: 404 });
  const query = new URL(request.url).searchParams;
  if (!query.has("evidence")) return NextResponse.json(audit);
  const baseline = await readRaw<{ rows: ResponseRow[] }>(audit.id, "responses");
  const history = audit.counterfactuals ?? [];
  const attempt = history.find((item) => item.id === query.get("attempt")) ?? history[history.length - 1];
  const arms = attempt ? await readRaw<{ baseline: ArmRun; placebo: ArmRun; fix: ArmRun }>(audit.id, `counterfactual-${attempt.id}`) : undefined;
  return NextResponse.json({
    audit,
    responses: trim(baseline?.rows),
    attempt: attempt && arms ? { id: attempt.id, attempt: attempt.attempt, baseline: trim(arms.baseline.rows), placebo: trim(arms.placebo.rows), fix: trim(arms.fix.rows) } : null,
  });
}
