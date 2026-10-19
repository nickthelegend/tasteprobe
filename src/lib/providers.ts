import OpenAI from "openai";
import type { Persona, TasteTag } from "./types";

const QLOO_URL = "https://api.qloo.com";

async function qloo(path: string, params: Record<string, string>) {
  const key = process.env.QLOO_API_KEY;
  if (!key) throw new Error("Add QLOO_API_KEY to .env.local to load real taste data.");
  const url = new URL(path, QLOO_URL);
  Object.entries(params).forEach(([name, value]) => url.searchParams.set(name, value));
  const response = await fetch(url, { headers: { "x-api-key": key, accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`Qloo request failed (${response.status}): ${await response.text()}`);
  return response.json();
}

export async function resolvePlace(brand: string, city: string) {
  const payload = await qloo("/search", { query: brand, types: "urn:entity:place", take: "10" });
  const candidates = payload.results ?? payload.entities ?? [];
  const normalizedCity = city.toLocaleLowerCase();
  const match = candidates.find((item: any) => {
    const location = `${item.properties?.address ?? ""} ${item.properties?.geocode?.city ?? ""}`.toLocaleLowerCase();
    return location.includes(normalizedCity);
  }) ?? candidates[0];
  if (!match?.entity_id && !match?.id) throw new Error(`Qloo could not resolve “${brand}” as a place. Try its exact listing name.`);
  return { id: match.entity_id ?? match.id, name: match.name ?? brand, raw: payload };
}

const affinityTypes = [
  { segment: "Cuisine", type: "urn:tag:genre:restaurant" },
  { segment: "Music", type: "urn:tag:genre:music" },
  { segment: "Places", type: "urn:tag:genre:place" },
  { segment: "Culture", type: "urn:tag:keyword" },
];

export async function buildPersonas(entityId: string, city: string, limit: number): Promise<{ personas: Persona[]; raw: unknown[] }> {
  const batches = await Promise.all(affinityTypes.map(async ({ segment, type }) => {
    const payload = await qloo("/v2/insights", {
      "filter.type": "urn:tag",
      "signal.interests.entities": entityId,
      "signal.location.query": city,
      "filter.tag.types": type,
      take: String(Math.min(50, limit)),
    });
    const tags: TasteTag[] = (payload.results?.tags ?? []).map((tag: any) => ({
      name: tag.name,
      id: tag.tag_id ?? tag.tag_value,
      affinity: typeof tag.affinity === "number" ? tag.affinity : undefined,
      types: tag.types,
    })).filter((tag: TasteTag) => tag.name && tag.id);
    return { segment, tags, payload };
  }));
  const available: { segment: string; tag: TasteTag }[] = [];
  for (let index = 0; available.length < limit; index++) {
    let found = false;
    for (const batch of batches) {
      if (batch.tags[index]) {
        available.push({ segment: batch.segment, tag: batch.tags[index] });
        found = true;
        if (available.length === limit) break;
      }
    }
    if (!found) break;
  }
  if (available.length === 0) throw new Error("Qloo returned no taste tags for this place and city. Check the place selection or try another city.");
  const personas = available.slice(0, limit).map(({ segment, tag }, index) => ({
    id: `qloo-${index + 1}`,
    name: `${segment} affinity: ${tag.name}`,
    segment,
    affinities: [tag],
  }));
  return { personas, raw: batches.map((batch, index) => ({ segment: batch.segment, payload: batch.payload })) };
}

type ChatModel = { id: string; name: string; client: OpenAI; model: string };
function configuredModels(): ChatModel[] {
  const models: ChatModel[] = [];
  if (process.env.OPENAI_API_KEY) models.push({
    id: "openai", name: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini", client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  });
  for (const slot of [2, 3]) {
    const apiKey = process.env[`MODEL_${slot}_API_KEY`];
    const baseURL = process.env[`MODEL_${slot}_BASE_URL`];
    const model = process.env[`MODEL_${slot}_ID`];
    if (apiKey && baseURL && model) models.push({
      id: `system-${slot}`,
      name: process.env[`MODEL_${slot}_NAME`] ?? model,
      model,
      client: new OpenAI({ apiKey, baseURL }),
    });
  }
  return models;
}

export function getTestModels() {
  return configuredModels().map(({ name }) => name);
}

export async function queryTestModels(prompt: string) {
  const models = configuredModels();
  if (!models.length) throw new Error("Configure OPENAI_API_KEY or MODEL_2_API_KEY, MODEL_2_BASE_URL, and MODEL_2_ID to test a real assistant.");
  return Promise.all(models.map(async ({ client, model, name }) => {
    const completion = await client.chat.completions.create({ model, messages: [{ role: "user", content: prompt }], temperature: 0 });
    return { model: name, answer: completion.choices[0]?.message?.content ?? "", raw: completion };
  }));
}

export async function extractEntities(answer: string, brand: string, category: string, city: string) {
  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey) throw new Error("Add NEBIUS_API_KEY to .env.local to extract entities with NVIDIA Nemotron on Nebius.");
  const client = new OpenAI({ apiKey, baseURL: process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1" });
  const model = process.env.NEBIUS_MODEL ?? "nvidia/Nemotron-3-Nano-30B-A3B";
  const completion = await client.chat.completions.create({
    model, temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Extract restaurant or brand entities explicitly recommended in the answer. Return only JSON: {\"entities\":[\"name\"]}. Do not include the target unless it is explicitly named." },
      { role: "user", content: `Target: ${brand}. Category: ${category}. Location: ${city}. Answer:\n${answer}` },
    ],
  });
  const raw = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as { entities?: unknown };
  const entities = Array.isArray(parsed.entities) ? parsed.entities.filter((item): item is string => typeof item === "string") : [];
  return { model, entities, raw: completion };
}

export async function suggestContentChange(brand: string, category: string, city: string, segment: string, competitors: string[]) {
  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey) throw new Error("Add NEBIUS_API_KEY to .env.local to use the Nemotron counterfactual agent.");
  const client = new OpenAI({ apiKey, baseURL: process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1" });
  const model = process.env.NEBIUS_MODEL ?? "nvidia/Nemotron-3-Nano-30B-A3B";
  const completion = await client.chat.completions.create({
    model, temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Propose one specific, testable restaurant website content change likely to help AI assistants match the restaurant to the stated taste segment. Do not claim it has been deployed. Return JSON: {\"change\":\"one or two sentences\"}." },
      { role: "user", content: JSON.stringify({ brand, category, city, tasteSegment: segment, observedCompetitors: competitors }) },
    ],
  });
  const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as { change?: unknown };
  if (typeof parsed.change !== "string" || !parsed.change.trim()) throw new Error("Nemotron did not return a usable content suggestion.");
  return { change: parsed.change.trim(), model, raw: completion };
}
