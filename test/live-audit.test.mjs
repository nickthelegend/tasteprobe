import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildReport, renderReportHtml } from "../src/lib/report.mjs";
import { summarizeObservations } from "../src/lib/stats.mjs";

const script = fileURLToPath(new URL("../scripts/live-audit.mjs", import.meta.url));

function run(args, dataDir) {
  // Clean environment and an empty working directory: no keys and no .env.local can be picked up.
  return spawnSync(process.execPath, [script, ...args], {
    cwd: dataDir, encoding: "utf8", timeout: 20_000,
    env: { PATH: process.env.PATH ?? "", HOME: dataDir, TASTEPROBE_DATA_DIR: path.join(dataDir, "data") },
  });
}

// Synthetic test data in the shape the app writes: it exists only inside this test's temp dir
// and is never shown by the app.
function syntheticRun() {
  const rows = [];
  for (let index = 0; index < 8; index++) {
    rows.push({
      personaId: `p${index}`, segment: "Cocktail Bar place genre", model: "assistant-a",
      prompt: `persona prompt ${index} <b>`, answer: "1. Test Venue\n2. Rival", entities: index < 3 ? ["Test Venue", "Rival"] : ["Rival"],
      brand: index < 3, listEntities: index < 3 ? ["Test Venue", "Rival"] : ["Rival"],
    });
  }
  const failures = [{ personaId: "p8", segment: "Cocktail Bar place genre", model: "assistant-a", kind: "unparseable", error: "no JSON" }];
  const observations = rows.map((row) => ({ segment: row.segment, personaId: row.personaId, brand: row.brand, recommended: row.entities.filter((name) => name !== "Test Venue") }));
  const audit = {
    id: "11111111-2222-3333-4444-555555555555", brand: "Test Venue", qlooEntityId: "TEST", category: "bar", city: "Testville",
    createdAt: "2026-10-21T00:00:00.000Z", personas: [], systems: ["assistant-a"], responseCount: 8, failedResponses: 1,
    overall: summarizeObservations(observations.map((row) => ({ ...row, segment: "All personas" })), failures.map((row) => ({ ...row, segment: "All personas" })))[0],
    segments: summarizeObservations(observations, failures), modelSegments: [], extractionModel: "nvidia/test", extractionUsage: { inputTokens: 0, outputTokens: 0 },
    estimatedExtractionCostUsd: null, durationMs: 1,
    meta: { assistants: [{ name: "assistant-a", model: "a-1", host: "example.test" }], assistantTemperature: 0.7, personaSeed: 7, liftBootstrapSeed: 41, extractionSystemPrompt: "extract", nemotronMaxTokens: 8192, nemotronThinking: "model default" },
  };
  return { audit, responses: { rows, failures } };
}

test("live run without keys prints Setup required per variable and exits 1 before any API call", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tasteprobe-live-"));
  try {
    const result = run(["--brand", "Test Venue", "--city", "Testville"], dir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Setup required: QLOO_API_KEY/);
    assert.match(result.stderr, /Setup required: NEBIUS_API_KEY/);
    assert.match(result.stderr, /Setup required: OPENAI_API_KEY/);
    assert.match(result.stderr, /No API was called/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bad arguments and unknown replay ids fail loudly", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tasteprobe-live-"));
  try {
    assert.equal(run(["--city", "Testville"], dir).status, 1);
    assert.match(run(["--brand", "X", "--city", "Y", "--personas", "4"], dir).stderr, /at least 8 per taste segment/);
    const missing = run(["--replay", "nope"], dir);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /No recorded run nope/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("replay re-renders from cached responses with a visible replay banner and file hashes", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tasteprobe-live-"));
  try {
    const { audit, responses } = syntheticRun();
    const data = path.join(dir, "data");
    await mkdir(path.join(data, "raw", audit.id), { recursive: true });
    await writeFile(path.join(data, "audits.json"), JSON.stringify([audit]));
    await writeFile(path.join(data, "raw", audit.id, "responses.json"), JSON.stringify(responses));
    const result = run(["--replay", audit.id], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`Replay of run ${audit.id} recorded 2026-10-21T00:00:00.000Z`));
    assert.match(result.stdout, /matches the stored summary/);
    const html = await readFile(path.join(data, "reports", `${audit.id}.replay.html`), "utf8");
    assert.match(html, /Replay of run 11111111-2222-3333-4444-555555555555 recorded 2026-10-21T00:00:00.000Z/);
    assert.match(html, /persona prompt 0 &lt;b&gt;/);
    const report = JSON.parse(await readFile(path.join(data, "reports", `${audit.id}.replay.json`), "utf8"));
    assert.equal(report.mode, "replay");
    assert.equal(report.rawFiles.length, 1);
    assert.match(report.rawFiles[0].sha256, /^[0-9a-f]{64}$/);
    assert.equal(report.failureRates.byKind.unparseable, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("report recomputes shares from raw responses and records seeds, models and failure rates", () => {
  const { audit, responses } = syntheticRun();
  const report = buildReport({ audit, responses, rawFiles: [], mode: "live", recordedAt: audit.createdAt, renderedAt: audit.createdAt, runtime: "test" });
  assert.equal(report.results.overall.share, 3 / 8);
  assert.equal(report.results.matchesStoredSummary, true);
  assert.equal(report.seeds.persona, 7);
  assert.equal(report.models.assistants[0].model, "a-1");
  assert.equal(report.failureRates.attempted, 9);
  assert.equal(report.prompts.personas.length, 8);
  const html = renderReportHtml(report);
  assert.match(html, /Live run 11111111/);
  assert.doesNotMatch(html, /Replay of run/);
  const tampered = buildReport({ audit, responses: { ...responses, rows: responses.rows.slice(1) }, rawFiles: [], mode: "replay", recordedAt: "x", renderedAt: "y", runtime: "test" });
  assert.equal(tampered.results.matchesStoredSummary, false);
});
