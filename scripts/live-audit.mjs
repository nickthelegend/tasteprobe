#!/usr/bin/env node
// One-command live audit with a preflight, a reproducible report and an offline replay.
//
//   npm run audit:live -- --brand "The Bombay Canteen" --city Mumbai [--category restaurant] [--personas 24]
//   npm run audit:live -- --replay <run id>
//
// Live runs need QLOO_API_KEY, NEBIUS_API_KEY and OPENAI_API_KEY (or MODEL_2_*), read from the
// environment or .env.local in the current directory. Nothing is printed from those values.
// Reports go to <data dir>/reports/<id>.json and .html (data dir: TASTEPROBE_DATA_DIR or ./.data).
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_NEBIUS_MODEL } from "../src/lib/nebius.mjs";
import { tagSupportLine } from "../src/lib/persona-source.mjs";
import { QLOO_HACKATHON_BASE_URL, readQlooResponse } from "../src/lib/qloo.mjs";
import { buildReport, renderReportHtml } from "../src/lib/report.mjs";
import { pickPlace } from "../src/lib/taste.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else { args[key] = next; index++; }
  }
  return args;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function loadEnvFiles() {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(process.cwd(), name);
    if (existsSync(file) && typeof process.loadEnvFile === "function") process.loadEnvFile(file);
  }
}

const dataDir = () => process.env.TASTEPROBE_DATA_DIR || path.join(process.cwd(), ".data");
const safeId = (id) => String(id).replace(/[^a-zA-Z0-9-]/g, "");

function missingVariables() {
  const missing = [];
  if (!process.env.QLOO_API_KEY) missing.push("QLOO_API_KEY");
  if (!process.env.NEBIUS_API_KEY) missing.push("NEBIUS_API_KEY");
  const extra = [2, 3].some((slot) => process.env[`MODEL_${slot}_API_KEY`] && process.env[`MODEL_${slot}_BASE_URL`] && process.env[`MODEL_${slot}_ID`]);
  if (!process.env.OPENAI_API_KEY && !extra) missing.push("OPENAI_API_KEY (or MODEL_2_API_KEY, MODEL_2_BASE_URL and MODEL_2_ID)");
  return missing;
}

async function call(label, url, init) {
  let response;
  try { response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) }); }
  catch (error) { throw new Error(`${label}: network error (${error instanceof Error ? error.message : String(error)})`); }
  const text = await response.text();
  if (response.status === 401 || response.status === 403) throw new Error(`${label}: ${response.status}, key rejected`);
  if (!response.ok) throw new Error(`${label}: ${response.status} ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function qlooGet(qlooBase, path, params) {
  const url = new URL(path, qlooBase);
  url.search = new URLSearchParams(params).toString();
  let response;
  try { response = await fetch(url, { headers: { "x-api-key": process.env.QLOO_API_KEY, accept: "application/json" }, signal: AbortSignal.timeout(30_000) }); }
  catch (error) { throw new Error(`Qloo ${path}: network error (${error instanceof Error ? error.message : String(error)})`); }
  return readQlooResponse({ path, params, status: response.status, body: await response.text(), baseUrl: qlooBase });
}

// The cheapest real call each key allows: Qloo /search, then one 1-tag /v2/insights urn:tag call on
// the resolved place (does this key get urn:tag, or will personas come from urn:entity types?),
// Nebius /models (and the configured model must be listed), each assistant's /models (a 1-token
// completion if /models is not served).
async function preflight(brand, city) {
  const results = [];
  const qlooBase = process.env.QLOO_BASE_URL || QLOO_HACKATHON_BASE_URL;
  // A 404 is Qloo's documented "No results": the key was accepted.
  const found = await qlooGet(qlooBase, "/search", { query: brand, types: "urn:entity:place", take: "15" });
  results.push(`Qloo ${new URL(qlooBase).host}: /search ok${found.noResults ? ` (no listing matches "${brand}" yet; the audit will say so)` : ""}`);
  let place = null;
  try { place = pickPlace(found.results ?? found.entities ?? [], brand, city); }
  catch (error) { results.push(`Qloo urn:tag check skipped: ${error instanceof Error ? error.message : String(error)}`); }
  if (place) {
    try {
      await qlooGet(qlooBase, "/v2/insights", { "filter.type": "urn:tag", "signal.interests.entities": place.id, "signal.location.query": city, take: "1" });
      results.push(tagSupportLine(place.name, { ok: true }));
    } catch (error) {
      results.push(tagSupportLine(place.name, { ok: false, error }));
    }
  }

  const nebiusBase = (process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.nebius.com/v1").replace(/\/$/, "");
  const wanted = process.env.NEBIUS_MODEL || DEFAULT_NEBIUS_MODEL;
  const catalog = await call("Nebius /models", `${nebiusBase}/models`, { headers: { authorization: `Bearer ${process.env.NEBIUS_API_KEY}` } });
  const ids = Array.isArray(catalog?.data) ? catalog.data.map((item) => item.id) : [];
  if (!ids.includes(wanted)) throw new Error(`Nebius: ${wanted} is not in this key's catalog. NVIDIA models listed: ${ids.filter((id) => id.toLowerCase().startsWith("nvidia/")).join(", ") || "none"}`);
  results.push(`Nebius: ${wanted} listed`);

  const assistants = [];
  if (process.env.OPENAI_API_KEY) assistants.push({ label: "OpenAI", key: process.env.OPENAI_API_KEY, base: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1", model: process.env.OPENAI_MODEL || "gpt-4o-mini" });
  for (const slot of [2, 3]) {
    const key = process.env[`MODEL_${slot}_API_KEY`];
    const base = process.env[`MODEL_${slot}_BASE_URL`];
    const model = process.env[`MODEL_${slot}_ID`];
    if (key && base && model) assistants.push({ label: `MODEL_${slot}`, key, base, model });
  }
  for (const assistant of assistants) {
    const base = assistant.base.replace(/\/$/, "");
    const headers = { authorization: `Bearer ${assistant.key}`, "content-type": "application/json" };
    try {
      await call(`${assistant.label} /models`, `${base}/models`, { headers });
    } catch (error) {
      if (/key rejected/.test(error.message)) throw error;
      await call(`${assistant.label} 1-token completion`, `${base}/chat/completions`, { method: "POST", headers, body: JSON.stringify({ model: assistant.model, max_tokens: 1, messages: [{ role: "user", content: "ok" }] }) });
    }
    results.push(`${assistant.label}: ${assistant.model} reachable`);
  }
  return results;
}

async function hashRawFiles(id) {
  const directory = path.join(dataDir(), "raw", safeId(id));
  if (!existsSync(directory)) return [];
  const files = [];
  for (const name of (await readdir(directory)).filter((item) => item.endsWith(".json")).sort()) {
    const bytes = await readFile(path.join(directory, name));
    files.push({ name: `raw/${safeId(id)}/${name}`, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  return files;
}

async function readRecorded(id) {
  const audits = JSON.parse(await readFile(path.join(dataDir(), "audits.json"), "utf8").catch(() => "[]"));
  const audit = audits.find((item) => item.id === id);
  if (!audit) fail(`No recorded run ${id} in ${path.join(dataDir(), "audits.json")}.`);
  const responsesFile = path.join(dataDir(), "raw", safeId(id), "responses.json");
  if (!existsSync(responsesFile)) fail(`Run ${id} has no cached responses at ${responsesFile}; nothing to replay.`);
  return { audit, responses: JSON.parse(await readFile(responsesFile, "utf8")) };
}

async function writeReport(report, suffix = "") {
  const directory = path.join(dataDir(), "reports");
  await mkdir(directory, { recursive: true });
  const base = path.join(directory, `${safeId(report.runId)}${suffix}`);
  await writeFile(`${base}.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
  await writeFile(`${base}.html`, renderReportHtml(report), { mode: 0o600 });
  return base;
}

const runtime = () => `node ${process.version} on ${process.platform}`;

async function replay(id) {
  const { audit, responses } = await readRecorded(safeId(id));
  const rawFiles = await hashRawFiles(audit.id);
  const recordedReport = path.join(dataDir(), "reports", `${safeId(audit.id)}.json`);
  if (existsSync(recordedReport)) {
    const recorded = new Map(JSON.parse(await readFile(recordedReport, "utf8")).rawFiles.map((file) => [file.name, file.sha256]));
    for (const file of rawFiles) if (recorded.has(file.name)) file.matchesRecorded = recorded.get(file.name) === file.sha256;
  }
  const report = buildReport({ audit, responses, rawFiles, mode: "replay", recordedAt: audit.createdAt, renderedAt: new Date().toISOString(), runtime: runtime() });
  const base = await writeReport(report, ".replay");
  console.log(`Replay of run ${audit.id} recorded ${audit.createdAt}`);
  console.log(`Overall share ${Math.round((report.results.overall?.share ?? 0) * 100)}% recomputed from ${report.failureRates.answered} cached answers (${report.results.matchesStoredSummary ? "matches" : "DIFFERS from"} the stored summary).`);
  const changed = rawFiles.filter((file) => file.matchesRecorded === false);
  if (changed.length) console.log(`Warning: ${changed.length} raw file(s) changed since the live report: ${changed.map((file) => file.name).join(", ")}`);
  console.log(`Wrote ${base}.html and ${base}.json`);
}

async function live(args) {
  const brand = typeof args.brand === "string" ? args.brand.trim() : "";
  const city = typeof args.city === "string" ? args.city.trim() : "";
  if (!brand || !city) fail("Usage: npm run audit:live -- --brand \"Exact listing name\" --city City [--category restaurant] [--personas 24]\n       npm run audit:live -- --replay <run id>");
  const personaCount = args.personas === undefined ? 24 : Number(args.personas);
  if (!Number.isInteger(personaCount) || personaCount < 8 || personaCount > 200) fail("--personas must be a whole number from 8 to 200 (at least 8 per taste segment).");
  const category = typeof args.category === "string" ? args.category.trim() : "restaurant";

  const missing = missingVariables();
  if (missing.length) {
    for (const name of missing) console.error(`Setup required: ${name}`);
    console.error("Add the keys to .env.local (see .env.example). No API was called.");
    process.exit(1);
  }
  try {
    for (const line of await preflight(brand, city)) console.log(`Preflight ok · ${line}`);
  } catch (error) {
    fail(`Preflight failed · ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!process.features?.typescript) fail(`Live runs import the TypeScript pipeline directly and need Node 22.18+ (type stripping). This is ${process.version}.`);

  const { runAudit } = await import("../src/lib/audit.ts");
  const started = new Date().toISOString();
  const audit = await runAudit({ brand, city, category, personaCount }, (event) => {
    if (event.type === "stage") console.log(`· ${event.message}`);
    if (event.type === "place") console.log(`· Matched in Qloo: ${event.name}${event.address ? `, ${event.address}` : ""} (${event.entityId})`);
    if (event.type === "progress") process.stdout.write(`\r· ${event.done}/${event.total} personas answered · ${event.mentions} mentions`);
  }, "cli").catch((error) => fail(`\nAudit failed · ${error instanceof Error ? error.message : String(error)}`));
  process.stdout.write("\n");
  const { responses } = await readRecorded(audit.id);
  const report = buildReport({ audit, responses, rawFiles: await hashRawFiles(audit.id), mode: "live", recordedAt: audit.createdAt ?? started, renderedAt: new Date().toISOString(), runtime: runtime() });
  const base = await writeReport(report);
  console.log(`Run ${audit.id}: share of voice ${Math.round(audit.overall.share * 100)}% (95% CI ${Math.round(audit.overall.ci[0] * 100)}–${Math.round(audit.overall.ci[1] * 100)}%), ${report.failureRates.failed}/${report.failureRates.attempted} calls failed.`);
  console.log(`Wrote ${base}.html and ${base}.json`);
}

loadEnvFiles();
const args = parseArgs(process.argv.slice(2));
if (args.replay) {
  if (typeof args.replay !== "string") fail("Usage: npm run audit:live -- --replay <run id>");
  await replay(args.replay);
} else {
  await live(args);
}
