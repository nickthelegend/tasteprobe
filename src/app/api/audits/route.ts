import { NextResponse } from "next/server";
import { z } from "zod";
import { buildPersonas, extractEntities, getTestModels, queryTestModels, resolvePlace } from "@/lib/providers";
import { summarizeObservations } from "@/lib/stats.mjs";
import { readAudits, saveAudit } from "@/lib/storage";
import type { Audit, Persona } from "@/lib/types";

export const maxDuration = 300;
type ExtractionRun = { extraction: { raw: { usage?: { prompt_tokens?: number | null; completion_tokens?: number | null } | null } } };
const requestSchema = z.object({
  brand: z.string().trim().min(2).max(100),
  category: z.string().trim().min(2).max(80),
  city: z.string().trim().min(2).max(80),
  personaCount: z.number().int().min(4).max(100).default(20),
});

function promptFor(brand: string, category: string, city: string, persona: Persona) {
  const taste = persona.affinities.map((item) => item.name).join(", ");
  return `You are choosing where to eat in ${city}. Your interests include ${taste}. Recommend up to 5 ${category} restaurants in ${city} and briefly explain each choice. Include only real businesses. Do not favor any brand without a reason. The target being measured is ${brand}.`;
}

export async function GET() {
  return NextResponse.json(await readAudits());
}

async function pool<T, R>(values: T[], concurrency: number, task: (value: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await task(values[index]);
    }
  }));
  return output;
}

export async function POST(request: Request) {
  try {
    const input = requestSchema.parse(await request.json());
    if (!process.env.QLOO_API_KEY) throw new Error("Add QLOO_API_KEY to .env.local to load real Qloo taste data.");
    if (!process.env.NEBIUS_API_KEY) throw new Error("Add NEBIUS_API_KEY to .env.local to extract entities with NVIDIA Nemotron on Nebius.");
    if (!getTestModels().length) throw new Error("Configure OPENAI_API_KEY or an OpenAI-compatible MODEL_2_* or MODEL_3_* endpoint to test a real assistant.");
    const place = await resolvePlace(input.brand, input.city);
    const personaBuild = await buildPersonas(place.id, input.city, input.personaCount);
    const personas = personaBuild.personas;
    const prompts = personas.map((persona) => ({ persona, prompt: promptFor(place.name, input.category, input.city, persona) }));
    const runs = await pool(prompts, 3, async ({ persona, prompt }) => {
      const systems = await queryTestModels(prompt);
      const extracted = await Promise.all(systems.map(async (system) => {
        const output = await extractEntities(system.answer, place.name, input.category, input.city);
        return { persona, system, extraction: output, prompt };
      }));
      return extracted;
    });
    const rows = runs.flat();
    const auditId = crypto.randomUUID();
    const observations = rows.map(({ persona, system, extraction }) => ({
      segment: persona.segment,
      personaId: persona.id,
      brand: extraction.entities.some((entity) => entity.toLocaleLowerCase().includes(place.name.toLocaleLowerCase())),
      recommended: extraction.entities.filter((entity) => !entity.toLocaleLowerCase().includes(place.name.toLocaleLowerCase())),
    }));
    const audit: Audit = {
      id: auditId,
      brand: place.name,
      category: input.category,
      city: input.city,
      createdAt: new Date().toISOString(),
      personas,
      segments: summarizeObservations(observations),
      systems: [...new Set(rows.map(({ system }) => system.model))],
      modelSegments: [...new Set(rows.map(({ system }) => system.model))].map((model) => ({
        model,
        segments: summarizeObservations(observations.filter((_, index) => rows[index].system.model === model)),
      })),
      responseCount: rows.length,
      extractionModel: process.env.NEBIUS_MODEL ?? "nvidia/Nemotron-3-Nano-30B-A3B",
      extractionInputTokens: rows.reduce((total, row) => total + (row.extraction.raw.usage?.prompt_tokens ?? 0), 0),
      extractionOutputTokens: rows.reduce((total, row) => total + (row.extraction.raw.usage?.completion_tokens ?? 0), 0),
      estimatedExtractionCostUsd: estimateExtractionCost(rows),
    };
    await saveAudit(audit);
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const rawDirectory = join(process.cwd(), ".data", "raw", auditId);
    await mkdir(rawDirectory, { recursive: true });
    await writeFile(join(rawDirectory, "responses.json"), JSON.stringify(rows, null, 2), { mode: 0o600 });
    await writeFile(join(rawDirectory, "qloo.json"), JSON.stringify({ search: place.raw, insights: personaBuild.raw }, null, 2), { mode: 0o600 });
    return NextResponse.json(audit);
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "Audit failed unexpectedly.";
    return NextResponse.json({ error: message }, { status: error instanceof z.ZodError ? 400 : 502 });
  }
}

function estimateExtractionCost(rows: ExtractionRun[]) {
  const inputRate = Number(process.env.NEBIUS_INPUT_PRICE_PER_MILLION);
  const outputRate = Number(process.env.NEBIUS_OUTPUT_PRICE_PER_MILLION);
  if (!Number.isFinite(inputRate) || !Number.isFinite(outputRate)) return null;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const row of rows) {
    inputTokens += row.extraction.raw.usage?.prompt_tokens ?? 0;
    outputTokens += row.extraction.raw.usage?.completion_tokens ?? 0;
  }
  if (inputTokens + outputTokens === 0) return null;
  return (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000;
}
