import OpenAI from "openai";
import { parseJsonObject } from "./json.mjs";
import { QLOO_HACKATHON_BASE_URL, readQlooResponse } from "./qloo.mjs";
import { DEFAULT_NEBIUS_MODEL, reasoningLabel, reasoningParams, reasoningText } from "./nebius.mjs";
import { collectPersonaSignals, type PersonaSignals } from "./persona-source.mjs";
import { requestSignal, runSignal, throwIfDeadline, untilDeadline } from "./run-deadline.mjs";
import { CROSS_DOMAIN_TYPES, matchesBrand, parseQlooDemographics, parseQlooEntities, parseQlooTags, pickPlace, type QlooEntity } from "./taste.mjs";
import type { QlooSignals, Usage } from "./types";

export class ConfigError extends Error {}
// Nemotron answered but its output could not be parsed (or was cut off at max_tokens). Counted
// separately from call failures so dropped answers show up in the denominators.
export class UnparseableError extends Error {}

const QLOO_BASE_URL = () => process.env.QLOO_BASE_URL || QLOO_HACKATHON_BASE_URL;
const NEBIUS_BASE_URL = () => process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1";
export const nebiusModel = () => process.env.NEBIUS_MODEL || DEFAULT_NEBIUS_MODEL;
const REQUEST_TIMEOUT_MS = 120_000;
// Reasoning models spend tokens thinking before the JSON; 2048 truncated long answers.
const nemotronMaxTokens = () => Number(process.env.NEBIUS_MAX_TOKENS) || 8192;

const MODEL_SLOT_VARS = (slot: number) => [`MODEL_${slot}_API_KEY`, `MODEL_${slot}_BASE_URL`, `MODEL_${slot}_ID`];

// Names of the variables a live audit needs and that are not set. With no assistant at all that is
// OPENAI_API_KEY; a MODEL_2_* / MODEL_3_* slot that is only partly set names its missing variables
// instead of being ignored. The minimum setup is two keys: QLOO_API_KEY and NEBIUS_API_KEY, with
// MODEL_2_* pointing at a non-NVIDIA chat model on Nebius Token Factory (see .env.example).
export function missingKeys() {
  const missing: string[] = [];
  if (!process.env.QLOO_API_KEY) missing.push("QLOO_API_KEY");
  if (!process.env.NEBIUS_API_KEY) missing.push("NEBIUS_API_KEY");
  const partial = [2, 3].flatMap((slot) => {
    const vars = MODEL_SLOT_VARS(slot);
    const set = vars.filter((name) => process.env[name]);
    return set.length && set.length < vars.length ? vars.filter((name) => !process.env[name]) : [];
  });
  if (partial.length) missing.push(...partial);
  else if (!configuredModels().length) missing.push("OPENAI_API_KEY");
  return missing;
}

export function requireKeys() {
  if (!process.env.QLOO_API_KEY) throw new ConfigError("Qloo key not configured: add QLOO_API_KEY to .env.local and restart the server.");
  if (!process.env.NEBIUS_API_KEY) throw new ConfigError("Nebius key not configured: add NEBIUS_API_KEY to .env.local to run NVIDIA Nemotron on Nebius.");
  const incomplete = missingKeys().filter((name) => name.startsWith("MODEL_"));
  if (incomplete.length) throw new ConfigError(`Assistant endpoint incomplete: set ${incomplete.join(", ")} in .env.local (MODEL_n_API_KEY, MODEL_n_BASE_URL and MODEL_n_ID go together).`);
  if (!configuredModels().length) throw new ConfigError("No assistant to test: set OPENAI_API_KEY or a MODEL_2_* OpenAI-compatible endpoint in .env.local.");
}

async function qloo(path: string, params: Record<string, string>) {
  const key = process.env.QLOO_API_KEY;
  if (!key) throw new ConfigError("Qloo key not configured: add QLOO_API_KEY to .env.local and restart the server.");
  const url = new URL(path, QLOO_BASE_URL());
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  // The 30 s request timeout, plus the run's deadline (run-deadline.mjs) when one is running.
  const response = await untilDeadline(fetch(url, {
    headers: { "x-api-key": key, accept: "application/json" },
    cache: "no-store",
    signal: requestSignal(30_000),
  }));
  return readQlooResponse({ path, params, status: response.status, body: await response.text(), baseUrl: QLOO_BASE_URL() });
}

// Resolves the venue in its city. Never falls back to a namesake elsewhere or to another venue in
// the same city: pickPlace throws with the candidate list when no in-city listing matches the name.
export async function resolvePlace(brand: string, city: string) {
  const payload = await qloo("/search", { query: brand, types: "urn:entity:place", take: "15" });
  return { ...pickPlace(payload.results ?? payload.entities ?? [], brand, city), raw: payload };
}

// Looks a recommended rival up in Qloo: "verified" means a place with a matching name in the city.
export async function verifyRival(name: string, city: string): Promise<{ name: string; status: "verified" | "unverified"; qlooId?: string; detail?: string }> {
  try {
    const payload = await qloo("/search", { query: name, types: "urn:entity:place", take: "5" });
    const place = pickPlace(payload.results ?? payload.entities ?? [], name, city, { strict: false });
    return matchesBrand(place.name, name, { city }) || matchesBrand(name, place.name, { city })
      ? { name, status: "verified", qlooId: place.id }
      : { name, status: "unverified", detail: `closest Qloo listing in ${city} is ${place.name}` };
  } catch (error) {
    throwIfDeadline();
    return { name, status: "unverified", detail: error instanceof Error ? error.message.slice(0, 200) : String(error) };
  }
}

// Persona signals for the venue: urn:tag taste tags, or urn:entity affinities when the key refuses
// urn:tag with a 403 (the hackathon host's documented answer for unsupported types). See
// src/lib/persona-source.mjs.
export function fetchPersonaSignals(entityId: string, city: string, venueName: string) {
  return collectPersonaSignals(qloo, { entityId, city, venueName });
}

// True when QLOO_BASE_URL is the hackathon host (the default), where only urn:entity types work.
export function qlooOnHackathonHost() {
  try { return new URL(QLOO_BASE_URL()).host === new URL(QLOO_HACKATHON_BASE_URL).host; } catch { return true; }
}

// One /v2/insights call for any entity's taste neighbourhood: `filterType` is urn:tag or an
// urn:entity type, `entityId` the venue or a rival, `location` the city (signal.location.query).
// Returns names and affinities; the raw payload goes back separately so callers keep it server-side.
export async function qlooTasteProfile({ entityId, filterType, location, take = 12 }: { entityId: string; filterType: string; location?: string; take?: number }) {
  const params: Record<string, string> = { "filter.type": filterType, "signal.interests.entities": entityId, take: String(take) };
  if (location) params["signal.location.query"] = location;
  const payload = await qloo("/v2/insights", params);
  const items = filterType === "urn:tag"
    ? parseQlooTags(payload).map((tag) => ({ name: tag.name, affinity: tag.affinity ?? null, kind: tag.subtype }))
    : parseQlooEntities(payload).map((entity) => ({ name: entity.name, affinity: entity.affinity ?? null, kind: filterType }));
  return { items: items.slice(0, take), raw: payload };
}

// Cross-domain taste: artists, brands, films and books with affinity to the venue (city-scoped),
// plus the urn:demographics lean. Each call can fail on its own without failing the audit; the
// error is recorded. Parameter names: filter.type, signal.interests.entities, signal.location.query
// and take (max 50), all listed for artist, book, brand and movie in docs.qloo.com/reference/parameters.
// filter.type=urn:demographics takes signal.interests.entities only (docs.qloo.com/reference/demographics-use-case).
// `prefetched` (the urn:entity persona results) is reused instead of asking Qloo twice.
export async function fetchCrossDomainSignals(entityId: string, city: string, prefetched: PersonaSignals["entityResults"] = null) {
  const crossDomain: Record<string, QlooEntity[]> = {};
  const raw: unknown[] = [];
  const signals: QlooSignals = { domains: [], demographics: null };
  await Promise.all(CROSS_DOMAIN_TYPES.map(async (type) => {
    const reused = prefetched?.[type];
    if (reused) {
      crossDomain[type] = reused.entities;
      signals.domains.push({ type, entities: reused.entities.map((item) => item.name), ...(reused.error ? { error: reused.error } : {}) });
      return;
    }
    try {
      const payload = await qloo("/v2/insights", { "filter.type": `urn:entity:${type}`, "signal.interests.entities": entityId, "signal.location.query": city, take: "10" });
      raw.push({ type, payload });
      crossDomain[type] = parseQlooEntities(payload);
      signals.domains.push({ type, entities: crossDomain[type].map((item) => item.name) });
    } catch (error) {
      throwIfDeadline();
      signals.domains.push({ type, entities: [], error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
    }
  }));
  try {
    const payload = await qloo("/v2/insights", { "filter.type": "urn:demographics", "signal.interests.entities": entityId });
    raw.push({ type: "demographics", payload });
    signals.demographics = parseQlooDemographics(payload);
  } catch (error) {
    throwIfDeadline();
    signals.demographicsError = error instanceof Error ? error.message.slice(0, 200) : String(error);
  }
  signals.domains.sort((a, b) => CROSS_DOMAIN_TYPES.indexOf(a.type) - CROSS_DOMAIN_TYPES.indexOf(b.type));
  return { crossDomain, signals, raw };
}

type ChatModel = { id: string; name: string; model: string; client: OpenAI };

function configuredModels(): ChatModel[] {
  const models: ChatModel[] = [];
  if (process.env.OPENAI_API_KEY) {
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    models.push({ id: "openai", name: model, model, client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: REQUEST_TIMEOUT_MS, maxRetries: 2 }) });
  }
  for (const slot of [2, 3]) {
    const [apiKey, baseURL, model] = MODEL_SLOT_VARS(slot).map((name) => process.env[name]);
    if (apiKey && baseURL && model) models.push({
      id: `system-${slot}`,
      name: process.env[`MODEL_${slot}_NAME`] || model,
      model,
      client: new OpenAI({ apiKey, baseURL, timeout: REQUEST_TIMEOUT_MS, maxRetries: 2 }),
    });
  }
  return models;
}

export function nebiusPrices() {
  const input = Number(process.env.NEBIUS_INPUT_PRICE_PER_MILLION);
  const output = Number(process.env.NEBIUS_OUTPUT_PRICE_PER_MILLION);
  if (!process.env.NEBIUS_INPUT_PRICE_PER_MILLION || !process.env.NEBIUS_OUTPUT_PRICE_PER_MILLION || !Number.isFinite(input) || !Number.isFinite(output)) return null;
  return { input, output };
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

export const ASSISTANT_TEMPERATURE = 0.7;

// Model IDs and hosts of the assistants under test (never keys), recorded with each audit.
export function assistantsMeta() {
  return configuredModels().map(({ name, model, client }) => ({ name, model, host: new URL(client.baseURL).host }));
}

export function nemotronSettings() {
  return { maxTokens: nemotronMaxTokens(), thinking: thinkingSetting() };
}

export async function askAssistants(prompt: string) {
  return Promise.all(configuredModels().map(async ({ client, model, name }) => {
    try {
      const completion = await untilDeadline(client.chat.completions.create({ model, messages: [{ role: "user", content: prompt }], temperature: ASSISTANT_TEMPERATURE }, { signal: runSignal() }));
      return { model: name, ok: true as const, answer: completion.choices[0]?.message?.content ?? "" };
    } catch (error) {
      throwIfDeadline();
      return { model: name, ok: false as const, error: `${name}: ${describe(error)}` };
    }
  }));
}

function nebius() {
  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey) throw new ConfigError("Nebius key not configured: add NEBIUS_API_KEY to .env.local to run NVIDIA Nemotron on Nebius.");
  return new OpenAI({ apiKey, baseURL: NEBIUS_BASE_URL(), timeout: REQUEST_TIMEOUT_MS, maxRetries: 2 });
}

// Optional reasoning settings (see src/lib/nebius.mjs for what each one is based on). Unset sends
// nothing; an invalid value is a setup error, never silently dropped.
function thinkingParams(): Record<string, unknown> {
  try { return reasoningParams(process.env); }
  catch (error) { throw new ConfigError(error instanceof Error ? error.message : String(error)); }
}

function thinkingSetting() {
  try { return reasoningLabel(process.env); }
  catch (error) { return `invalid: ${error instanceof Error ? error.message : String(error)}`; }
}

function usageOf(completion: OpenAI.Chat.ChatCompletion): Usage {
  return { inputTokens: completion.usage?.prompt_tokens ?? 0, outputTokens: completion.usage?.completion_tokens ?? 0 };
}

async function nemotron(messages: OpenAI.Chat.ChatCompletionMessageParam[], temperature: number) {
  const model = nebiusModel();
  try {
    const completion = await untilDeadline(nebius().chat.completions.create({ model, messages, temperature, max_tokens: nemotronMaxTokens(), ...thinkingParams() }, { signal: runSignal() }));
    const choice = completion.choices[0];
    return { model, text: choice?.message?.content ?? "", usage: usageOf(completion), finishReason: choice?.finish_reason ?? null };
  } catch (error) {
    throwIfDeadline();
    if (error instanceof ConfigError) throw error;
    throw new Error(`Nebius ${model}: ${describe(error)}`);
  }
}

// One agent turn with OpenAI-style tool calling (Nebius documents `tools` and `tool_choice` on
// chat completions). Returns the assistant message so the caller can execute its tool calls.
export async function nemotronTurn(messages: OpenAI.Chat.ChatCompletionMessageParam[], tools: OpenAI.Chat.ChatCompletionTool[]) {
  const model = nebiusModel();
  try {
    const completion = await untilDeadline(nebius().chat.completions.create({ model, messages, tools, tool_choice: "auto", temperature: 0.4, max_tokens: nemotronMaxTokens(), ...thinkingParams() }, { signal: runSignal() }));
    const choice = completion.choices[0];
    const message = choice?.message ?? { role: "assistant" as const, content: "", refusal: null };
    return { model, message, usage: usageOf(completion), finishReason: choice?.finish_reason ?? null, reasoning: reasoningText(message) };
  } catch (error) {
    throwIfDeadline();
    if (error instanceof ConfigError) throw error;
    throw new Error(`Nebius ${model}: ${describe(error)}`);
  }
}

export const EXTRACTION_SYSTEM_PROMPT = "You extract recommendations from an assistant's answer. List every distinct business or venue the answer recommends, using the name exactly as written, without addresses or branch notes. Ignore businesses mentioned only as comparisons. Reply with JSON only: {\"entities\":[\"Name\", ...]}.";

export async function extractEntities(answer: string, category: string, city: string) {
  const { text, usage, model, finishReason } = await nemotron([
    { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
    { role: "user", content: `Category: ${category}\nCity: ${city}\n\nAnswer:\n${answer}` },
  ], 0);
  if (finishReason === "length") throw new UnparseableError(`Nemotron hit max_tokens (${nemotronMaxTokens()}) before finishing the extraction.`);
  let parsed: Record<string, unknown>;
  try { parsed = parseJsonObject(text); }
  catch (error) { throw new UnparseableError(error instanceof Error ? error.message : String(error)); }
  if (!Array.isArray(parsed.entities)) throw new UnparseableError(`Nemotron's JSON has no "entities" array: ${text.slice(0, 160)}`);
  const entities = [...new Set(parsed.entities.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
  return { model, entities, usage, raw: text };
}

export const COPY_RULES = "Phrase it as copy the business would publish, under 45 words, with no prices, awards or claims that would need verification.";

export async function suggestContentChange(input: { brand: string; category: string; city: string; segment: string; tastes: string[]; competitors: string[] }) {
  const { text, usage, model } = await nemotron([
    { role: "system", content: `You are a local-search strategist. Propose ONE specific, factual-sounding but non-fabricated content addition the business could publish on its website or listings so AI assistants connect it to the stated taste segment. ${COPY_RULES} Reply with JSON only: {"change":"...","rationale":"one sentence"}.` },
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
