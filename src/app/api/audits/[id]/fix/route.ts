import { NextResponse } from "next/server";
import { readAudits, saveAudit } from "@/lib/storage";
import { extractEntities, queryTestModels, suggestContentChange } from "@/lib/providers";
import { bootstrapInterval } from "@/lib/stats.mjs";

export const maxDuration = 300;

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

export async function POST(_: Request, context: { params: { id: string } }) {
  try {
    const audit = (await readAudits()).find((item) => item.id === context.params.id);
    if (!audit) return NextResponse.json({ error: "Audit not found." }, { status: 404 });
    const segment = audit.segments.slice().sort((a, b) => a.share - b.share)[0];
    const personas = audit.personas.filter((item) => item.segment === segment?.name);
    if (!segment || !personas.length) throw new Error("No taste segment is available to re-test.");
    const competitors = segment.competitors.slice(0, 3).map((item) => item.name);
    const suggestion = await suggestContentChange(audit.brand, audit.category, audit.city, segment.name, competitors);
    const runs = await pool(personas, 3, async (persona) => {
      const prompt = `You are choosing where to eat in ${audit.city}. Your interests include ${persona.affinities.map((item) => item.name).join(", ")}. Recommend up to 5 ${audit.category} restaurants in ${audit.city} and explain each choice. Consider this additional website information for ${audit.brand}: ${suggestion.change}. Include only real businesses.`;
      const systems = await queryTestModels(prompt);
      return Promise.all(systems.map(async (system) => {
        const extracted = await extractEntities(system.answer, audit.brand, audit.category, audit.city);
        return { persona, system: system.model, answer: system.answer, extraction: extracted, prompt };
      }));
    });
    const rows = runs.flat();
    const beforeRows = await (async () => {
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      try {
        const raw = JSON.parse(await readFile(join(process.cwd(), ".data", "raw", audit.id, "responses.json"), "utf8")) as { persona: { segment: string }; extraction: { entities: string[] } }[];
        return raw.filter((row) => row.persona.segment === segment.name);
      } catch { return []; }
    })();
    const before = beforeRows.length ? beforeRows.filter((row) => row.extraction.entities.some((name) => name.toLocaleLowerCase().includes(audit.brand.toLocaleLowerCase()))).length / beforeRows.length : segment.share;
    const outcomes = rows.map((row) => row.extraction.entities.some((name) => name.toLocaleLowerCase().includes(audit.brand.toLocaleLowerCase())));
    const after = outcomes.filter(Boolean).length / Math.max(outcomes.length, 1);
    audit.counterfactual = { change: suggestion.change, segment: segment.name, before, after, interval: bootstrapInterval(outcomes), responses: rows.length };
    await saveAudit(audit);
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await writeFile(join(process.cwd(), ".data", "raw", audit.id, "counterfactual.json"), JSON.stringify({ suggestion: { ...suggestion }, rows }, null, 2), { mode: 0o600 });
    return NextResponse.json(audit.counterfactual);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Counterfactual re-test failed." }, { status: 502 });
  }
}
