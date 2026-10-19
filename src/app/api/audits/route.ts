import { NextResponse } from "next/server";
import { z } from "zod";
import { estimateCost, pool, probePersona, sumUsage, toObservations, type FailedRow, type ResponseRow } from "@/lib/probe";
import { fetchTasteTags, nebiusModel, requireKeys, resolvePlace } from "@/lib/providers";
import { summarizeObservations } from "@/lib/stats.mjs";
import { readAudits, saveAudit, writeRaw } from "@/lib/storage";
import { buildPersonas, personaPrompt } from "@/lib/taste.mjs";
import type { Audit, AuditEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const requestSchema = z.object({
  brand: z.string().trim().min(2, "Enter the business name.").max(100),
  category: z.string().trim().min(2, "Enter a category.").max(80),
  city: z.string().trim().min(2, "Enter a city.").max(80),
  personaCount: z.number().int().min(4).max(200).default(24),
});

export async function GET() {
  return NextResponse.json(await readAudits());
}

export async function POST(request: Request) {
  let input: z.infer<typeof requestSchema>;
  try {
    input = requestSchema.parse(await request.json());
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
        const taste = await fetchTasteTags(place.id, input.city);
        const personas = buildPersonas(taste.tags, input.personaCount);
        send({ type: "personas", personas });

        const auditId = crypto.randomUUID();
        await writeRaw(auditId, "qloo", { search: place.raw, insights: taste.raw });

        send({ type: "stage", stage: "query", message: `Asking assistants as ${personas.length} Qloo personas` });
        const rows: ResponseRow[] = [];
        const failures: FailedRow[] = [];
        let done = 0;
        await pool(personas, 4, async (persona) => {
          const result = await probePersona(persona, personaPrompt(persona, input.category, input.city), place.name, input.category, input.city);
          rows.push(...result.rows);
          failures.push(...result.failures);
          done++;
          send({ type: "progress", done, total: personas.length, mentions: rows.filter((row) => row.brand).length });
        });
        await writeRaw(auditId, "responses", { rows, failures });
        if (!rows.length) throw new Error(`Every assistant call failed. First error: ${failures[0]?.error ?? "unknown"}`);

        send({ type: "stage", stage: "stats", message: "Computing share of voice and bootstrap intervals" });
        const observations = toObservations(rows, place.name);
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
          overall: summarizeObservations(observations.map((row) => ({ ...row, segment: "All personas" })))[0],
          segments: summarizeObservations(observations),
          modelSegments: systems.map((model) => ({
            model,
            segments: summarizeObservations(observations.filter((_, index) => rows[index].model === model)),
          })),
          systems,
          responseCount: rows.length,
          failedResponses: failures.length,
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
