// A fix or agent run that hits the wall-clock deadline keeps the answers it already paid for:
// raw/<audit id>/counterfactual-<id>.json (complete: false) for a fix, and the probe in flight
// in the agent trace (complete: false). The assistants and Nemotron are in-test stand-ins passed
// through runFix's / runAgent's deps (test/ only): a probe answers for the first personas and
// never answers for the rest, standing in for a stuck upstream. Every base URL points at a closed
// local port and the key values are placeholders, so nothing can reach a provider.
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const dir = await mkdtemp(path.join(tmpdir(), "tasteprobe-partial-"));
Object.assign(process.env, {
  TASTEPROBE_DATA_DIR: dir,
  QLOO_API_KEY: "placeholder", QLOO_BASE_URL: "http://127.0.0.1:9",
  NEBIUS_API_KEY: "placeholder", NEBIUS_BASE_URL: "http://127.0.0.1:9/v1",
  MODEL_2_API_KEY: "placeholder", MODEL_2_BASE_URL: "http://127.0.0.1:9/v1", MODEL_2_ID: "stand-in",
});
delete process.env.OPENAI_API_KEY;
const { runFix } = await import("../src/lib/fix.ts");
const { runAgent, emptyTrace } = await import("../src/lib/agent.ts");
const { deadlineMessage, RunDeadlineError, runWithDeadline, untilDeadline } = await import("../src/lib/run-deadline.mjs");
const { RunGate, runPolicy } = await import("../src/lib/run-guard.mjs");

const fixture = JSON.parse(await readFile(new URL("./fixtures/audit-synthetic.json", import.meta.url), "utf8"));
const personas = Array.from({ length: 8 }, (_, index) => ({ id: `q${index}`, segment: "Place keyword", segmentId: "place-keyword", affinities: [{ id: `t${index}`, name: `Taste ${index}`, affinity: 0.5 }] }));
const audit = { ...fixture, personas };
await writeFile(path.join(dir, "audits.json"), JSON.stringify([audit]));
test.after(() => rm(dir, { recursive: true, force: true }));

const usage = { inputTokens: 1, outputTokens: 1 };
// Answers for the first `answered` personas; the rest never answer (until the deadline aborts them).
function standInProbe(answered) {
  return async (persona, prompt) => {
    if (Number(persona.id.slice(1)) >= answered) return untilDeadline(new Promise(() => {}));
    return { rows: [{ personaId: persona.id, segment: persona.segment, model: "stand-in", prompt, answer: "1. Rival One", entities: ["Rival One"], brand: false, listEntities: ["Rival One"], extractionRaw: "", usage }], failures: [] };
  };
}
const deadline = (ms, kind) => new RunGate().start("127.0.0.1", { ...runPolicy({}), deadlineMs: ms }, kind);
const rawFiles = async (prefix) => (await readdir(path.join(dir, "raw", audit.id)).catch(() => [])).filter((name) => name.startsWith(prefix));

test("a fix that hits the deadline keeps its paid answers in raw/<audit id> and adds no attempt", async () => {
  const slot = deadline(400, "fix");
  const suggestion = async () => ({ change: "Synthetic copy for the test.", rationale: "test", model: "stand-in", usage, raw: "{}" });
  await assert.rejects(runWithDeadline(slot.signal, () => runFix(audit.id, "place-keyword", { suggestContentChange: suggestion, probePersona: standInProbe(3) })), (error) => {
    assert.ok(error instanceof RunDeadlineError);
    assert.match(deadlineMessage(error, audit.id), new RegExp(`raw/<audit id>/, marked complete: false; the run slot is free again\\. Audit id: ${audit.id}\\.$`));
    return true;
  });
  const files = await rawFiles("counterfactual-");
  assert.equal(files.length, 1);
  const saved = JSON.parse(await readFile(path.join(dir, "raw", audit.id, files[0]), "utf8"));
  assert.equal(saved.complete, false);
  assert.equal(saved.personasDone, 3);
  assert.equal(saved.personasTotal, 8);
  assert.equal(saved.suggestion.change, "Synthetic copy for the test.");
  for (const arm of ["baseline", "placebo", "fix"]) assert.deepEqual(saved[arm].rows.map((row) => row.personaId).sort(), ["q0", "q1", "q2"], arm);
  const stored = JSON.parse(await readFile(path.join(dir, "audits.json"), "utf8"));
  assert.equal(stored[0].counterfactuals.length, fixture.counterfactuals.length, "an incomplete attempt never joins the history");
});

test("an agent probe in flight at the deadline is in the trace with the answers already paid for", async () => {
  const slot = deadline(400, "agent");
  const turns = [
    [{ id: "t1", type: "function", function: { name: "propose_copy", arguments: JSON.stringify({ copy: "Synthetic copy for the agent test." }) } }],
    [{ id: "t2", type: "function", function: { name: "probe_segment", arguments: JSON.stringify({ candidate_id: "c1", n: 8 }) } }],
  ];
  let turn = 0;
  const nemotronTurn = async () => ({ model: "stand-in", message: { role: "assistant", content: "", tool_calls: turns[turn++] }, usage, finishReason: "tool_calls", reasoning: "" });
  const trace = emptyTrace();
  const limits = { maxTries: 3, maxAssistantCalls: 1000, maxUsd: null, maxNemotronTokens: 5_000_000, maxTurns: 10 };
  await assert.rejects(runWithDeadline(slot.signal, () => runAgent(audit, audit.segments.find((item) => item.id === "place-keyword"), limits, () => {}, trace, { nemotronTurn, probePersona: standInProbe(2) })), RunDeadlineError);
  assert.equal(trace.probes.length, 1);
  const [probe] = trace.probes;
  assert.equal(probe.complete, false);
  assert.equal(probe.candidateId, "c1");
  assert.deepEqual(probe.placebo.rows.map((row) => row.personaId).sort(), ["q0", "q1"]);
  assert.deepEqual(probe.fix.rows.map((row) => row.personaId).sort(), ["q0", "q1"]);
});
