// The spend guard in front of the paid routes: run token, JSON only, persona and agent caps,
// per-IP bucket, daily quota and one run at a time. Pure; no server, no keys.
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CAPS, normalizeLimits } from "../src/lib/agent-core.mjs";
import { checkJsonContentType, checkPersonaCap, checkRunToken, clientAddress, publicPolicy, RunGate, runPolicy } from "../src/lib/run-guard.mjs";

const headers = (entries = {}) => new Headers(entries);

test("a client asking the agent for 1000 assistant calls gets the server cap, never more", () => {
  assert.equal(normalizeLimits({ maxAssistantCalls: 1000 }).maxAssistantCalls, 480);
  assert.equal(normalizeLimits({ maxNemotronTokens: 5_000_000, maxTurns: 40, maxTries: 8 }).maxNemotronTokens, DEFAULT_CAPS.maxNemotronTokens);
  assert.equal(normalizeLimits({ maxTurns: 40 }).maxTurns, 20);
  // Env caps lower it further; a client can always ask for less.
  const policy = runPolicy({ TASTEPROBE_AGENT_MAX_CALLS: "96", TASTEPROBE_AGENT_MAX_TRIES: "2", TASTEPROBE_AGENT_MAX_TURNS: "6", TASTEPROBE_AGENT_MAX_TOKENS: "50000" });
  const limits = normalizeLimits({ maxAssistantCalls: 1000, maxTries: 8, maxTurns: 40, maxNemotronTokens: 5_000_000 }, policy.agentCaps);
  assert.deepEqual([limits.maxAssistantCalls, limits.maxTries, limits.maxTurns, limits.maxNemotronTokens], [96, 2, 6, 50_000]);
  assert.equal(normalizeLimits({ maxAssistantCalls: 48 }, policy.agentCaps).maxAssistantCalls, 48);
});

test("TASTEPROBE_MAX_PERSONAS=24 answers 400 for 200 personas, with a readable message", () => {
  const policy = runPolicy({ TASTEPROBE_MAX_PERSONAS: "24" });
  assert.equal(policy.maxPersonas, 24);
  assert.deepEqual(checkPersonaCap(200, policy), { status: 400, body: { error: "This server allows at most 24 personas per audit (TASTEPROBE_MAX_PERSONAS).", code: "persona_cap", maxPersonas: 24 } });
  assert.equal(checkPersonaCap(24, policy), null);
  assert.equal(runPolicy({}).maxPersonas, 200);
  assert.equal(runPolicy({ TASTEPROBE_MAX_PERSONAS: "3" }).maxPersonas, 8, "never below one segment's 8 personas");
});

test("the run token is checked from a header; the token itself is never public", () => {
  const open = runPolicy({});
  assert.equal(checkRunToken(headers(), open), null);
  const locked = runPolicy({ TASTEPROBE_RUN_TOKEN: "s3cret" });
  assert.equal(checkRunToken(headers(), locked).status, 401);
  assert.match(checkRunToken(headers(), locked).body.error, /^Runs are disabled on this server/);
  assert.equal(checkRunToken(headers({ cookie: "x-tasteprobe-run-token=s3cret" }), locked).status, 401, "a cookie is not accepted");
  assert.equal(checkRunToken(headers({ "x-tasteprobe-run-token": "wrong" }), locked).status, 403);
  assert.equal(checkRunToken(headers({ "x-tasteprobe-run-token": "s3cret" }), locked), null);
  const shown = publicPolicy(locked);
  assert.equal(shown.locked, true);
  assert.doesNotMatch(JSON.stringify(shown), /s3cret/);
  assert.equal(publicPolicy(open).locked, false);
});

test("only application/json bodies are accepted (a cross-site text/plain form POST is refused)", () => {
  assert.equal(checkJsonContentType(headers({ "content-type": "text/plain" })).status, 415);
  assert.equal(checkJsonContentType(headers({ "content-type": "application/x-www-form-urlencoded" })).status, 415);
  assert.equal(checkJsonContentType(headers()).status, 415);
  assert.equal(checkJsonContentType(headers({ "content-type": "application/json; charset=utf-8" })), null);
});

test("one run at a time: a second start while a flight pours is a 429, and release frees the slot", () => {
  const gate = new RunGate(() => Date.parse("2026-10-22T10:00:00Z"));
  const policy = runPolicy({});
  const first = gate.start("1.1.1.1", policy, "audit");
  assert.equal(typeof first.release, "function");
  const second = gate.start("2.2.2.2", policy, "agent");
  assert.equal(second.status, 429);
  assert.equal(second.body.code, "busy");
  assert.match(second.body.error, /A flight is already pouring on this server \(audit started 0s ago\)/);
  first.release();
  first.release();
  const third = gate.start("2.2.2.2", policy, "fix");
  assert.equal(typeof third.release, "function");
});

test("per-IP token bucket: N runs an hour per address, refilled over time; other addresses unaffected", () => {
  let now = Date.parse("2026-10-22T10:00:00Z");
  const gate = new RunGate(() => now);
  const policy = runPolicy({ TASTEPROBE_RUNS_PER_IP_PER_HOUR: "2" });
  gate.start("9.9.9.9", policy, "audit").release();
  gate.start("9.9.9.9", policy, "audit").release();
  const limited = gate.start("9.9.9.9", policy, "audit");
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, "rate_limited");
  assert.equal(gate.checkQuota("9.9.9.9", policy).status, 429);
  assert.equal(gate.checkQuota("8.8.8.8", policy), null);
  now += 30 * 60_000; // half an hour refills one run at 2 per hour
  assert.equal(gate.checkQuota("9.9.9.9", policy), null);
  assert.equal(typeof gate.start("9.9.9.9", policy, "audit").release, "function");
});

test("daily quota per instance, reset at UTC midnight", () => {
  let now = Date.parse("2026-10-22T23:00:00Z");
  const gate = new RunGate(() => now);
  const policy = runPolicy({ TASTEPROBE_DAILY_RUNS: "2", TASTEPROBE_RUNS_PER_IP_PER_HOUR: "100" });
  gate.start("a", policy, "audit").release();
  gate.start("b", policy, "audit").release();
  const refused = gate.start("c", policy, "audit");
  assert.equal(refused.status, 429);
  assert.equal(refused.body.code, "daily_quota");
  now = Date.parse("2026-10-23T00:00:01Z");
  assert.equal(typeof gate.start("c", policy, "audit").release, "function");
});

test("client address: X-Real-IP, else the proxy's last X-Forwarded-For hop, else local", () => {
  assert.equal(clientAddress(headers({ "x-real-ip": "5.5.5.5", "x-forwarded-for": "1.1.1.1" })), "5.5.5.5");
  assert.equal(clientAddress(headers({ "x-forwarded-for": "6.6.6.6, 7.7.7.7" })), "7.7.7.7");
  assert.equal(clientAddress(headers()), "local");
});
