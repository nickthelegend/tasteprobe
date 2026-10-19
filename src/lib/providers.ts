import OpenAI from "openai";
import { parseJsonObject } from "./json.mjs";
import { parseQlooTags } from "./taste.mjs";
import type { TasteTag, Usage } from "./types";

export class ConfigError extends Error {}

const QLOO_BASE_URL = () => process.env.QLOO_BASE_URL || "https://hackathon.api.qloo.com";
const NEBIUS_BASE_URL = () => process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1";
export const nebiusModel = () => process.env.NEBIUS_MODEL || "nvidia/Nemotron-3-Nano-30B-A3B";
const REQUEST_TIMEOUT_MS = 90_000;

export function requireKeys() {
  if (!process.env.QLOO_API_KEY) throw new ConfigError("Qloo key not configured: add QLOO_API_KEY to .env.local and restart the server.");
  if (!process.env.NEBIUS_API_KEY) throw new ConfigError("Nebius key not configured: add NEBIUS_API_KEY to .env.local to run NVIDIA Nemotron on Nebius.");
  if (!configuredModels().length) throw new ConfigError("No assistant to test: set OPENAI_API_KEY or a MODEL_2_* OpenAI-compatible endpoint in .env.local.");
}

async function qloo(path: string, params: Record<string, string>) {
  const key = process.env.QLOO_API_KEY;
  if (!key) throw new ConfigError("Qloo key not configured: add QLOO_API_KEY to .env.local and restart the server.");
  const url = new URL(path, QLOO_BASE_URL());
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const response = await fetch(url, {
    headers: { "x-api-key": key, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Qloo ${path} returned ${response.status}: ${body.slice(0, 300) || response.statusText}`);
  return JSON.parse(body);
}

type QlooPlace = { entity_id?: string; id?: string; name?: string; properties?: { address?: string; geocode?: { city?: string; name?: string } }; location?: unknown };

export async function resolvePlace(brand: string, city: string) {
  const payload = await qloo("/search", { query: brand, types: "urn:entity:place", take: "15" });
  const candidates: QlooPlace[] = payload.results ?? payload.entities ?? [];
  const cityKey = city.toLocaleLowerCase();
  const inCity = (item: QlooPlace) => `${item.properties?.address ?? ""} ${item.properties?.geocode?.city ?? ""} ${item.properties?.geocode?.name ?? ""}`
    .toLocaleLowerCase().includes(cityKey);
  const match = candidates.find(inCity) ?? candidates[0];
  const id = match?.entity_id ?? match?.id;
  if (!match || !id) throw new Error(`Qloo found no place called “${brand}”. Try the exact listing name as it appears on maps.`);
  return {
    id,
    name: match.name ?? brand,
    address: match.properties?.address,
    cityMatched: inCity(match),
    raw: payload,
  };
}

export async function fetchTasteTags(entityId: string, city: string): Promise<{ tags: TasteTag[]; raw: unknown[] }> {
  const base = { "filter.type": "urn:tag", "signal.interests.entities": entityId, take: "50" };
  const local = await qloo("/v2/insights", { ...base, "signal.location.query": city });
  let tags = parseQlooTags(local);
  const raw: unknown[] = [{ scope: "city", payload: local }];
  if (tags.length < 6) {
    // Sparse local coverage: fall back to the place's global taste neighbourhood and say so in the cache.
    const global = await qloo("/v2/insights", base);
    raw.push({ scope: "global", payload: global });
    const seen = new Set(tags.map((tag) => tag.id));
    tags = [...tags, ...parseQlooTags(global).filter((tag) => !seen.has(tag.id))];
  }
  if (!tags.length) throw new Error("Qloo returned no taste tags for this place. Check the place name or try a better-known listing.");
  return { tags, raw };
}

type ChatModel = { id: string; name: string; model: string; client: OpenAI };

function configuredModels(): ChatModel[] {
  const models: ChatModel[] = [];
  if (process.env.OPENAI_API_KEY) {
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    models.push({ id: "openai", name: model, model, client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: REQUEST_TIMEOUT_MS, maxRetries: 2 }) });
  }
  for (const slot of [2, 3]) {
    const apiKey = process.env[`MODEL_${slot}_API_KEY`];
    const baseURL = process.env[`MODEL_${slot}_BASE_URL`];
    const model = process.env[`MODEL_${slot}_ID`];
    if (apiKey && baseURL && model) models.push({
      id: `system-${slot}`,
      name: process.env[`MODEL_${slot}_NAME`] || model,
      model,
      client: new OpenAI({ apiKey, baseURL, timeout: REQUEST_TIMEOUT_MS, maxRetries: 2 }),
    });
  }
  return models;
}

export function getTestModels() {
  return configuredModels().map(({ name }) => name);
}

function describe(error: unknown) {
  if (error instanceof OpenAI.APIError) {
    if (error.status === 401 || error.status === 403) return `${error.status}: key rejected (check the API key and base URL)`;
    const message = error.message.replace(/^\d{3}\s+/, "");
    return `${error.status ?? "network"}: ${message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function askAssistants(prompt: string) {
  return Promise.all(configuredModels().map(async ({ client, model, name }) => {
    try {
      const completion = await client.chat.completions.create({ model, messages: [{ role: "user", content: prompt }], temperature: 0.7 });
      return { model: name, ok: true as const, answer: completion.choices[0]?.message?.content ?? "" };
    } catch (error) {
      return { model: name, ok: false as const, error: `${name}: ${describe(error)}` };
    }
  }));
}

function nebius() {
  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey) throw new ConfigError("Nebius key not configured: add NEBIUS_API_KEY to .env.local to run NVIDIA Nemotron on Nebius.");
  return new OpenAI({ apiKey, baseURL: NEBIUS_BASE_URL(), timeout: REQUEST_TIMEOUT_MS, maxRetries: 2 });
}

async function nemotron(messages: OpenAI.Chat.ChatCompletionMessageParam[], temperature: number) {
  const model = nebiusModel();
  try {
    const completion = await nebius().chat.completions.create({ model, messages, temperature, max_tokens: 2048 });
    const usage: Usage = { inputTokens: completion.usage?.prompt_tokens ?? 0, outputTokens: completion.usage?.completion_tokens ?? 0 };
    return { model, text: completion.choices[0]?.message?.content ?? "", usage };
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new Error(`Nebius ${model}: ${describe(error)}`);
  }
}

export async function extractEntities(answer: string, category: string, city: string) {
  const { text, usage, model } = await nemotron([
    { role: "system", content: "You extract recommendations from an assistant's answer. List every distinct business or venue the answer recommends, using the name exactly as written, without addresses or branch notes. Ignore businesses mentioned only as comparisons. Reply with JSON only: {\"entities\":[\"Name\", ...]}." },
    { role: "user", content: `Category: ${category}\nCity: ${city}\n\nAnswer:\n${answer}` },
  ], 0);
  const parsed = parseJsonObject(text);
  const entities = Array.isArray(parsed.entities)
    ? [...new Set(parsed.entities.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
    : [];
  return { model, entities, usage, raw: text };
}

export async function suggestContentChange(input: { brand: string; category: string; city: string; segment: string; tastes: string[]; competitors: string[] }) {
  const { text, usage, model } = await nemotron([
    { role: "system", content: "You are a local-search strategist. Propose ONE specific, factual-sounding but non-fabricated content addition the business could publish on its website or listings so AI assistants connect it to the stated taste segment. Phrase it as copy the business would publish, under 45 words, with no prices, awards or claims that would need verification. Reply with JSON only: {\"change\":\"...\",\"rationale\":\"one sentence\"}." },
    { role: "user", content: JSON.stringify(input) },
  ], 0.3);
  const parsed = parseJsonObject(text);
  if (typeof parsed.change !== "string" || !parsed.change.trim()) throw new Error("Nemotron did not return a usable content suggestion.");
  return { change: parsed.change.trim(), rationale: typeof parsed.rationale === "string" ? parsed.rationale.trim() : "", model, usage, raw: text };
}

let catalogCache: { at: number; result: { ok: boolean; detail: string } } | undefined;

// Confirms the configured NVIDIA model is actually served for this Nebius key.
export async function checkNebiusModel() {
  if (!process.env.NEBIUS_API_KEY) return { ok: false, detail: "NEBIUS_API_KEY not set" };
  if (catalogCache && Date.now() - catalogCache.at < 5 * 60_000) return catalogCache.result;
  let result: { ok: boolean; detail: string };
  try {
    const ids: string[] = [];
    for await (const model of nebius().models.list()) ids.push(model.id);
    const wanted = nebiusModel();
    result = ids.includes(wanted)
      ? { ok: true, detail: wanted }
      : { ok: false, detail: `${wanted} is not in your Nebius catalog. NVIDIA models available: ${ids.filter((id) => id.toLowerCase().startsWith("nvidia/")).join(", ") || "none"}` };
  } catch (error) {
    result = { ok: false, detail: `Nebius catalog check failed: ${describe(error)}` };
  }
  catalogCache = { at: Date.now(), result };
  return result;
}
