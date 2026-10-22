import { runArms, summarizeArms, type ArmsRun } from "./experiment.ts";
import { coalescingWriter } from "./filestore.mjs";
import { probePersona } from "./probe.ts";
import { requireKeys, suggestContentChange } from "./providers.ts";
import { findAudit, updateAudit, writeRaw } from "./storage.ts";
import type { Counterfactual } from "./types";

// The audit or segment asked for does not exist (HTTP 404 / 400, an MCP input error).
// (No constructor parameter properties: Node's type stripping, used by the CLI and MCP server, rejects them.)
export class FixLookupError extends Error {
  status: 400 | 404;
  constructor(message: string, status: 400 | 404) { super(message); this.status = status; }
}

// One placebo-controlled fix attempt: Nemotron writes copy for a segment (the weakest one by
// default), then baseline, placebo and fix arms re-ask every assistant as the same personas.
// Used by POST /api/audits/[id]/fix and the MCP run_fix tool.
// Finds the audit, segment and personas a fix would re-test, or throws FixLookupError. Reads only:
// the fix route calls it before spending a run, so a bad id never costs quota.
export async function findFixTarget(auditId: string, segmentId?: string) {
  const audit = await findAudit(auditId);
  if (!audit) throw new FixLookupError("Audit not found.", 404);
  // Default to the weakest segment: lowest share, then the one where competitors are most visible.
  const segment = segmentId
    ? audit.segments.find((item) => item.id === segmentId)
    : [...audit.segments].sort((a, b) => a.share - b.share || (b.competitors[0]?.mentions ?? 0) - (a.competitors[0]?.mentions ?? 0))[0];
  if (!segment) throw new FixLookupError("That taste segment is not part of this audit.", 400);
  const personas = audit.personas.filter((persona) => persona.segment === segment.name);
  if (!personas.length) throw new FixLookupError("This segment has no personas to re-test.", 400);
  return { audit, segment, personas };
}

// The live calls a fix makes. Always the real providers in the app; test/ passes stand-ins.
export type FixDeps = { suggestContentChange: typeof suggestContentChange; probePersona: typeof probePersona };

export async function runFix(auditId: string, segmentId?: string, deps: Partial<FixDeps> = {}): Promise<Counterfactual> {
  const live = { suggestContentChange, probePersona, ...deps };
  requireKeys();
  const { audit, segment, personas } = await findFixTarget(auditId, segmentId);

  const tastes = [...new Set(personas.flatMap((persona) => persona.affinities.map((tag) => tag.name)))].slice(0, 8);
  const suggestion = await live.suggestContentChange({
    brand: audit.brand, category: audit.category, city: audit.city, segment: segment.name, tastes,
    competitors: segment.competitors.slice(0, 3).map((item) => item.name),
  });

  // Paid answers reach raw/<audit id>/counterfactual-<id>.json as they arrive (complete: false), so a
  // deadline or a crash mid-run keeps them; the attempt joins the audit's history only when complete.
  const id = crypto.randomUUID();
  const rawName = `counterfactual-${id}`;
  let partial: { run: ArmsRun | null; done: number } = { run: null, done: 0 };
  const writePartial = () => writeRaw(audit.id, rawName, { complete: false, personasDone: partial.done, personasTotal: personas.length, suggestion, segment: segment.name, ...(partial.run ?? {}) });
  await writePartial();
  const progress = coalescingWriter(writePartial);
  let run: ArmsRun;
  try {
    run = await runArms(audit, personas, suggestion.change, undefined, {
      probe: live.probePersona,
      onProgress: (current, done) => { partial = { run: current, done }; progress.schedule().catch(() => undefined); },
    });
  } finally {
    await progress.drain();
  }
  await writeRaw(audit.id, rawName, { complete: true, suggestion, segment: segment.name, ...run });
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
  return saved as Counterfactual;
}
