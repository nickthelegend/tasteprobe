import { NextResponse } from "next/server";
import { pool, probePersona, type FailedRow, type ResponseRow } from "@/lib/probe";
import { ConfigError, requireKeys, suggestContentChange } from "@/lib/providers";
import { bootstrapDifference, bootstrapInterval } from "@/lib/stats.mjs";
import { findAudit, readRaw, saveAudit, writeRaw } from "@/lib/storage";
import { counterfactualPrompt } from "@/lib/taste.mjs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request, context: { params: { id: string } }) {
  try {
    requireKeys();
    const audit = await findAudit(context.params.id);
    if (!audit) return NextResponse.json({ error: "Audit not found." }, { status: 404 });
    const body = await request.json().catch(() => ({})) as { segment?: string };
    // Default to the weakest segment: lowest share, then the one where competitors are most visible.
    const segment = body.segment
      ? audit.segments.find((item) => item.id === body.segment)
      : [...audit.segments].sort((a, b) => a.share - b.share || (b.competitors[0]?.mentions ?? 0) - (a.competitors[0]?.mentions ?? 0))[0];
    if (!segment) throw new Error("That taste segment is not part of this audit.");
    const personas = audit.personas.filter((persona) => persona.segment === segment.name);
    const baseline = await readRaw<{ rows: ResponseRow[] }>(audit.id, "responses");
    const beforeRows = baseline?.rows.filter((row) => row.segment === segment.name) ?? [];
    if (!beforeRows.length) throw new Error("The cached baseline responses for this segment are missing, so a before/after comparison is not possible.");

    const tastes = [...new Set(personas.flatMap((persona) => persona.affinities.map((tag) => tag.name)))].slice(0, 8);
    const suggestion = await suggestContentChange({
      brand: audit.brand, category: audit.category, city: audit.city, segment: segment.name, tastes,
      competitors: segment.competitors.slice(0, 3).map((item) => item.name),
    });

    const rows: ResponseRow[] = [];
    const failures: FailedRow[] = [];
    await pool(personas, 4, async (persona) => {
      const result = await probePersona(persona, counterfactualPrompt(persona, audit.category, audit.city, audit.brand, suggestion.change), audit.brand, audit.category, audit.city);
      rows.push(...result.rows);
      failures.push(...result.failures);
    });
    await writeRaw(audit.id, "counterfactual", { suggestion, segment: segment.name, rows, failures });
    if (!rows.length) throw new Error(`Every re-test call failed. First error: ${failures[0]?.error ?? "unknown"}`);

    const before = beforeRows.map((row) => row.brand);
    const after = rows.map((row) => row.brand);
    audit.counterfactual = {
      change: suggestion.change,
      segment: segment.name,
      before: before.filter(Boolean).length / before.length,
      beforeResponses: before.length,
      after: after.filter(Boolean).length / after.length,
      afterResponses: after.length,
      afterCi: bootstrapInterval(after),
      deltaCi: bootstrapDifference(before, after),
      model: suggestion.model,
      createdAt: new Date().toISOString(),
    };
    await saveAudit(audit);
    return NextResponse.json(audit.counterfactual);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Counterfactual re-test failed." }, { status: error instanceof ConfigError ? 503 : 502 });
  }
}
