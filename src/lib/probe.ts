import { askAssistants, extractEntities, nebiusPrices, UnparseableError } from "./providers.ts";
import { parseNumberedList } from "./extract.mjs";
import { matchesBrand } from "./taste.mjs";
import type { Persona, Usage } from "./types";

export type ResponseRow = {
  personaId: string;
  segment: string;
  model: string;
  prompt: string;
  answer: string;
  entities: string[];
  brand: boolean;
  // Names read deterministically off the answer's numbered list, to cross-check Nemotron.
  listEntities: string[];
  extractionRaw: string;
  usage: Usage;
};
// assistant: the tested assistant's call failed. unparseable: Nemotron answered but its output was not
// usable JSON (or was truncated). extraction: the Nemotron call itself failed.
export type FailureKind = "assistant" | "unparseable" | "extraction";
export type FailedRow = { personaId: string; segment: string; model?: string; kind: FailureKind; error: string };

export async function pool<T, R>(values: T[], concurrency: number, task: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await task(values[index], index);
    }
  }));
  return output;
}

// Ask every tested assistant the persona's prompt, then have Nemotron extract what each one recommended.
export async function probePersona(persona: Persona, prompt: string, brand: string, category: string, city: string) {
  const rows: ResponseRow[] = [];
  const failures: FailedRow[] = [];
  const answers = await askAssistants(prompt);
  await Promise.all(answers.map(async (result) => {
    if (!result.ok) {
      failures.push({ personaId: persona.id, segment: persona.segment, model: result.model, kind: "assistant", error: result.error });
      return;
    }
    try {
      const extraction = await extractEntities(result.answer, category, city);
      rows.push({
        personaId: persona.id,
        segment: persona.segment,
        model: result.model,
        prompt,
        answer: result.answer,
        entities: extraction.entities,
        brand: extraction.entities.some((entity) => matchesBrand(entity, brand, { city })),
        listEntities: parseNumberedList(result.answer),
        extractionRaw: extraction.raw,
        usage: extraction.usage,
      });
    } catch (error) {
      failures.push({ personaId: persona.id, segment: persona.segment, model: result.model, kind: error instanceof UnparseableError ? "unparseable" : "extraction", error: error instanceof Error ? error.message : String(error) });
    }
  }));
  return { rows, failures };
}

export function toObservations(rows: ResponseRow[], brand: string, city?: string) {
  return rows.map((row) => ({
    segment: row.segment,
    personaId: row.personaId,
    brand: row.brand,
    recommended: row.entities.filter((entity) => !matchesBrand(entity, brand, { city })),
  }));
}

export function sumUsage(rows: { usage: Usage }[]): Usage {
  return rows.reduce((total, row) => ({ inputTokens: total.inputTokens + row.usage.inputTokens, outputTokens: total.outputTokens + row.usage.outputTokens }), { inputTokens: 0, outputTokens: 0 });
}

export function estimateCost(usage: Usage) {
  const prices = nebiusPrices();
  return prices ? (usage.inputTokens * prices.input + usage.outputTokens * prices.output) / 1_000_000 : null;
}
