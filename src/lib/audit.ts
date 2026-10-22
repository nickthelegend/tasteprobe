import { summarizeCrossCheck } from "./extract.mjs";
import { estimateCost, pool, probePersona, sumUsage, toObservations, type FailedRow, type ResponseRow } from "./probe.ts";
import { ASSISTANT_TEMPERATURE, assistantsMeta, EXTRACTION_SYSTEM_PROMPT, fetchCrossDomainSignals, fetchPersonaSignals, nebiusModel, nemotronSettings, resolvePlace, verifyRival } from "./providers.ts";
import { LIFT_BOOTSTRAP_SEED, summarizeObservations } from "./stats.mjs";
import { coalescingWriter } from "./filestore.mjs";
import { saveAudit, writeRaw } from "./storage.ts";
import { buildPersonas, matchesBrand, PERSONA_SEED, personaPrompt } from "./taste.mjs";
import type { Audit, AuditEvent } from "./types";

export type AuditInput = { brand: string; category: string; city: string; personaCount: number };

// The whole live audit: resolve the venue in Qloo, build personas, ask every assistant as each
// persona, extract with Nemotron, summarise, save. Used by POST /api/audits and scripts/live-audit.mjs.
export async function runAudit(input: AuditInput, send: (event: AuditEvent) => void, origin: "web" | "cli" | "mcp" = "web"): Promise<Audit> {
  const started = Date.now();
  send({ type: "stage", stage: "resolve", message: `Resolving “${input.brand}” in Qloo` });
  const place = await resolvePlace(input.brand, input.city);
  send({ type: "place", name: place.name, entityId: place.id, address: place.address });

  send({ type: "stage", stage: "qloo", message: `Fetching taste affinities for ${place.name} in ${input.city}` });
  const taste = await fetchPersonaSignals(place.id, input.city, place.name);
  if (taste.source === "urn:entity") send({ type: "stage", stage: "qloo", message: "Qloo refused urn:tag for this key (403); building personas from artist, brand, film, book, TV, podcast and place affinities" });
  const cross = await fetchCrossDomainSignals(place.id, input.city, taste.entityResults);
  // With urn:entity personas the cross-domain types are already the segments, so they are not blended in twice.
  const personas = buildPersonas(taste.tags, input.personaCount, PERSONA_SEED, taste.source === "urn:tag" ? cross.crossDomain : {});
  send({ type: "personas", personas });

  const auditId = crypto.randomUUID();
  await writeRaw(auditId, "qloo", { search: place.raw, personaSource: taste.source, insights: taste.raw, crossDomain: cross.raw });

  send({ type: "stage", stage: "query", message: `Asking assistants as ${personas.length} Qloo personas` });
  const rows: ResponseRow[] = [];
  const failures: FailedRow[] = [];
  let done = 0;
  // Answers already paid for reach disk as they arrive (complete: false), so a crash or a killed
  // process leaves the partial rows in raw/<id>/responses.json instead of losing them.
  const progress = coalescingWriter(() => writeRaw(auditId, "responses", { complete: false, personasDone: done, personasTotal: personas.length, rows, failures }));
  await pool(personas, 4, async (persona) => {
    const result = await probePersona(persona, personaPrompt(persona, input.category, input.city), place.name, input.category, input.city);
    rows.push(...result.rows);
    failures.push(...result.failures);
    done++;
    progress.schedule().catch(() => undefined);
    send({
      type: "answer",
      personaId: persona.id,
      segmentId: persona.segmentId,
      answered: result.rows.length,
      mentioned: result.rows.filter((row) => row.brand).length,
      failed: result.failures.length,
      rivals: [...new Set(result.rows.flatMap((row) => row.entities))].filter((entity) => !matchesBrand(entity, place.name, { city: input.city })).slice(0, 3),
    });
    send({ type: "progress", done, total: personas.length, mentions: rows.filter((row) => row.brand).length });
  });
  await progress.drain();
  await writeRaw(auditId, "responses", { complete: true, rows, failures });
  if (!rows.length) throw new Error(`Every assistant call failed. First error: ${failures[0]?.error ?? "unknown"}`);

  send({ type: "stage", stage: "stats", message: "Computing share of voice and 95% intervals" });
  const observations = toObservations(rows, place.name, input.city);
  const overallRivals = summarizeObservations(observations.map((row) => ({ ...row, segment: "All personas" })))[0]?.competitors.map((item) => item.name) ?? [];
  send({ type: "stage", stage: "stats", message: `Checking ${overallRivals.length} top rivals in Qloo /search` });
  const systems = [...new Set(rows.map((row) => row.model))].sort();
  const usage = sumUsage(rows);
  const audit: Audit = {
    id: auditId,
    brand: place.name,
    qlooEntityId: place.id,
    qlooAddress: place.address,
    category: input.category,
    city: input.city,
    createdAt: new Date().toISOString(),
    personas,
    origin,
    personaSource: taste.source,
    ...(taste.tagRefusal ? { personaSourceNote: taste.tagRefusal } : {}),
    qlooSignals: cross.signals,
    overall: summarizeObservations(observations.map((row) => ({ ...row, segment: "All personas" })), failures.map((row) => ({ ...row, segment: "All personas" })))[0],
    segments: summarizeObservations(observations, failures),
    modelSegments: systems.map((model) => ({
      model,
      segments: summarizeObservations(observations.filter((_, index) => rows[index].model === model), failures.filter((row) => row.model === model)),
    })),
    systems,
    responseCount: rows.length,
    failedResponses: failures.length,
    failedByKind: {
      assistant: failures.filter((row) => row.kind === "assistant").length,
      unparseable: failures.filter((row) => row.kind === "unparseable").length,
      extraction: failures.filter((row) => row.kind === "extraction").length,
    },
    extractionCheck: summarizeCrossCheck(rows, place.name, input.city),
    rivalChecks: await pool(overallRivals, 4, (name) => verifyRival(name, input.city)),
    extractionModel: nebiusModel(),
    extractionUsage: usage,
    estimatedExtractionCostUsd: estimateCost(usage),
    durationMs: Date.now() - started,
    meta: {
      assistants: assistantsMeta(),
      assistantTemperature: ASSISTANT_TEMPERATURE,
      personaSeed: PERSONA_SEED,
      liftBootstrapSeed: LIFT_BOOTSTRAP_SEED,
      extractionSystemPrompt: EXTRACTION_SYSTEM_PROMPT,
      nemotronMaxTokens: nemotronSettings().maxTokens,
      nemotronThinking: nemotronSettings().thinking,
    },
  };
  await saveAudit(audit);
  return audit;
}
