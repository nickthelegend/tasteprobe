import { NextResponse } from "next/server";
import { runArms, summarizeArms } from "@/lib/experiment";
import { ConfigError, requireKeys, suggestContentChange } from "@/lib/providers";
import { findAudit, updateAudit, writeRaw } from "@/lib/storage";
import type { Counterfactual } from "@/lib/types";

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
    if (!personas.length) throw new Error("This segment has no personas to re-test.");

    const tastes = [...new Set(personas.flatMap((persona) => persona.affinities.map((tag) => tag.name)))].slice(0, 8);
    const suggestion = await suggestContentChange({
      brand: audit.brand, category: audit.category, city: audit.city, segment: segment.name, tastes,
      competitors: segment.competitors.slice(0, 3).map((item) => item.name),
    });

    const run = await runArms(audit, personas, suggestion.change);
    const id = crypto.randomUUID();
    await writeRaw(audit.id, `counterfactual-${id}`, { suggestion, segment: segment.name, ...run });
    for (const arm of ["baseline", "placebo", "fix"] as const) {
      if (!run[arm].rows.length) throw new Error(`Every ${arm} re-test call failed. First error: ${run[arm].failures[0]?.error ?? "unknown"}`);
    }

    let saved: Counterfactual | undefined;
    await updateAudit(audit.id, (current) => {
      const history = current.counterfactuals ?? [];
      saved = {
        id,
        attempt: history.length + 1,
        source: "fix",
        segment: segment.name,
        personas: personas.length,
        change: suggestion.change,
        rationale: suggestion.rationale,
        placebo: run.placeboCopy,
        ...summarizeArms(run),
        model: suggestion.model,
        createdAt: new Date().toISOString(),
      };
      current.counterfactuals = [...history, saved];
    });
    return NextResponse.json(saved);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Counterfactual re-test failed." }, { status: error instanceof ConfigError ? 503 : 502 });
  }
}
