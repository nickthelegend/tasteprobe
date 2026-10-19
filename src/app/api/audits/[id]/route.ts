import { NextResponse } from "next/server";
import type { ResponseRow } from "@/lib/probe";
import { findAudit, readRaw } from "@/lib/storage";

export const dynamic = "force-dynamic";

// Returns the audit plus the cached raw answers (?evidence=1) so every number can be traced to a response.
export async function GET(request: Request, context: { params: { id: string } }) {
  const audit = await findAudit(context.params.id);
  if (!audit) return NextResponse.json({ error: "Audit not found." }, { status: 404 });
  if (!new URL(request.url).searchParams.has("evidence")) return NextResponse.json(audit);
  const baseline = await readRaw<{ rows: ResponseRow[] }>(audit.id, "responses");
  const counterfactual = await readRaw<{ rows: ResponseRow[] }>(audit.id, "counterfactual");
  const trim = (rows: ResponseRow[] = []) => rows.map(({ personaId, segment, model, prompt, answer, entities, brand }) => ({ personaId, segment, model, prompt, answer, entities, brand }));
  return NextResponse.json({ audit, responses: trim(baseline?.rows), counterfactual: trim(counterfactual?.rows) });
}
