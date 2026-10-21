import { NextResponse } from "next/server";
import { z } from "zod";
import { estimateCost, pool, probePersona, sumUsage, toObservations, type FailedRow, type ResponseRow } from "@/lib/probe";
import { summarizeCrossCheck } from "@/lib/extract.mjs";
import { fetchCrossDomainSignals, fetchTasteTags, nebiusModel, requireKeys, resolvePlace, verifyRival } from "@/lib/providers";
import { summarizeObservations } from "@/lib/stats.mjs";
import { readAudits, saveAudit, writeRaw } from "@/lib/storage";
import { buildPersonas, matchesBrand, MIN_PERSONAS_PER_SEGMENT, PERSONA_SEED, personaPrompt } from "@/lib/taste.mjs";
import type { Audit, AuditEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const requestSchema = z.object({
  brand: z.string().trim().min(2, "Enter the business name.").max(100),
  category: z.string().trim().min(2, "Enter a category.").max(80),
  city: z.string().trim().min(2, "Enter a city.").max(80),
  personaCount: z.number().int().min(MIN_PERSONAS_PER_SEGMENT, `Use at least ${MIN_PERSONAS_PER_SEGMENT} personas (one segment needs ${MIN_PERSONAS_PER_SEGMENT}).`).max(200).default(24),
});

export async function GET() {
  return NextResponse.json(await readAudits());
}

export async function POST(request: Request) {
  let input: z.infer<typeof requestSchema>;
  try {
    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 }); }
    input = requestSchema.parse(body);
    requireKeys();
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "Invalid request.";
    return NextResponse.json({ error: message }, { status: error instanceof z.ZodError ? 400 : 503 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: AuditEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const started = Date.now();
      try {
        send({ type: "stage", stage: "resolve", message: `Resolving “${input.brand}” in Qloo` });
        const place = await resolvePlace(input.brand, input.city);
        send({ type: "place", name: place.name, entityId: place.id, address: place.address });

        send({ type: "stage", stage: "qloo", message: `Fetching taste affinities for ${place.name} in ${input.city}` });
        const [taste, cross] = await Promise.all([fetchTasteTags(place.id, input.city), fetchCrossDomainSignals(place.id, input.city)]);
        const personas = buildPersonas(taste.tags, input.personaCount, PERSONA_SEED, cross.crossDomain);
        send({ type: "personas", personas });

        const auditId = crypto.randomUUID();
        await writeRaw(auditId, "qloo", { search: place.raw, insights: taste.raw, crossDomain: cross.raw });

        send({ type: "stage", stage: "query", message: `Asking assistants as ${personas.length} Qloo personas` });
        const rows: ResponseRow[] = [];
        const failures: FailedRow[] = [];
        let done = 0;
        await pool(personas, 4, async (persona) => {
          const result = await probePersona(persona, personaPrompt(persona, input.category, input.city), place.name, input.category, input.city);
          rows.push(...result.rows);
          failures.push(...result.failures);
          done++;
          send({
            type: "answer",
            personaId: persona.id,
            segmentId: persona.segmentId,
            answered: result.rows.length,
            mentioned: result.rows.filter((row) => row.brand).length,
            failed: result.failures.length,
            rivals: [...new Set(result.rows.flatMap((row) => row.entities))].filter((entity) => !matchesBrand(entity, place.name)).slice(0, 3),
          });
          send({ type: "progress", done, total: personas.length, mentions: rows.filter((row) => row.brand).length });
        });
        await writeRaw(auditId, "responses", { rows, failures });
        if (!rows.length) throw new Error(`Every assistant call failed. First error: ${failures[0]?.error ?? "unknown"}`);

        send({ type: "stage", stage: "stats", message: "Computing share of voice and 95% intervals" });
        const observations = toObservations(rows, place.name);
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
          extractionCheck: summarizeCrossCheck(rows, place.name),
          rivalChecks: await pool(overallRivals, 4, (name) => verifyRival(name, input.city)),
          extractionModel: nebiusModel(),
          extractionUsage: usage,
          estimatedExtractionCostUsd: estimateCost(usage),
          durationMs: Date.now() - started,
        };
        await saveAudit(audit);
        send({ type: "done", audit });
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : "Audit failed unexpectedly." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
