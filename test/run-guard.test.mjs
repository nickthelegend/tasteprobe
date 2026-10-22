// The spend guard in front of the paid routes: run token, JSON only, persona and agent caps,
// per-IP bucket, daily quota and one run at a time. Pure; no server, no keys.
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CAPS, normalizeLimits } from "../src/lib/agent-core.mjs";
import { checkJsonContentType, checkPersonaCap, checkRunToken, clientAddress, MAX_BUCKETS, publicPolicy, RunGate, runPolicy } from "../src/lib/run-guard.mjs";

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

test("client address comes only from the header named in TASTEPROBE_TRUSTED_IP_HEADER; a client-set X-Real-IP is ignored otherwise", () => {
  const spoofed = headers({ "x-real-ip": "5.5.5.5", "x-forwarded-for": "1.1.1.1, 7.7.7.7" });
  // No trusted header configured: every caller shares one bucket rather than trusting what it sent.
  assert.equal(clientAddress(spoofed, runPolicy({})), "untrusted");
  assert.equal(runPolicy({}).trustedIpHeader, null);
  // Railway documents X-Real-IP as the client's remote IP; the deploy guide sets this.
  const railway = runPolicy({ TASTEPROBE_TRUSTED_IP_HEADER: "X-Real-IP" });
  assert.equal(railway.trustedIpHeader, "x-real-ip");
  assert.equal(clientAddress(spoofed, railway), "5.5.5.5");
  // X-Forwarded-For: the last hop, the one the trusted proxy appended.
  assert.equal(clientAddress(spoofed, runPolicy({ TASTEPROBE_TRUSTED_IP_HEADER: "x-forwarded-for" })), "7.7.7.7");
  assert.equal(clientAddress(headers(), railway), "untrusted");
});

test("in production with no run token, paid routes answer 503 Setup required unless TASTEPROBE_RUNS_OPEN=1", () => {
  const prod = runPolicy({ NODE_ENV: "production" });
  const refused = checkRunToken(headers(), prod);
  assert.equal(refused.status, 503);
  assert.equal(refused.body.code, "setup_required");
  assert.match(refused.body.error, /^Setup required: TASTEPROBE_RUN_TOKEN/);
  assert.equal(publicPolicy(prod).setupRequired, "TASTEPROBE_RUN_TOKEN");
  // An explicit opt-in keeps a production server open (local Docker); dev stays open by default.
  assert.equal(checkRunToken(headers(), runPolicy({ NODE_ENV: "production", TASTEPROBE_RUNS_OPEN: "1" })), null);
  assert.equal(checkRunToken(headers(), runPolicy({ NODE_ENV: "development" })), null);
  assert.equal(publicPolicy(runPolicy({})).setupRequired, null);
  // With a token, production is locked the usual way.
  assert.equal(checkRunToken(headers(), runPolicy({ NODE_ENV: "production", TASTEPROBE_RUN_TOKEN: "s3cret" })).status, 401);
});

test("the per-IP bucket map stays bounded: checks spend nothing and full buckets are dropped", () => {
  let now = Date.parse("2026-10-22T10:00:00Z");
  const gate = new RunGate(() => now);
  const policy = runPolicy({ TASTEPROBE_DAILY_RUNS: "1000000" });
  for (let index = 0; index < 100_000; index += 1) gate.checkQuota(`1.2.${index >> 8}.${index & 255}`, policy);
  assert.equal(gate.buckets.size, 0, "a quota check stores nothing for a full bucket");
  gate.start("9.9.9.9", policy, "audit").release();
  assert.equal(gate.buckets.size, 1);
  now += 2 * 3_600_000; // refilled
  gate.checkQuota("9.9.9.9", policy);
  assert.equal(gate.buckets.size, 0, "a refilled bucket is deleted");
  // Hard cap: spending runs from many addresses never grows the map past MAX_BUCKETS.
  for (let index = 0; index < MAX_BUCKETS + 50; index += 1) gate.start(`10.0.${index >> 8}.${index & 255}`, policy, "audit").release();
  assert.ok(gate.buckets.size <= MAX_BUCKETS);
  // The newest address is kept; the oldest was evicted.
  assert.ok(gate.buckets.has(`10.0.${(MAX_BUCKETS + 49) >> 8}.${(MAX_BUCKETS + 49) & 255}`));
  assert.ok(!gate.buckets.has("10.0.0.0"));
});

test("running state is public: kind and start time, for an explainable busy 429", () => {
  const now = Date.parse("2026-10-22T10:00:00Z");
  const gate = new RunGate(() => now);
  assert.deepEqual(gate.snapshot(), { running: null, runsToday: 0 });
  const slot = gate.start("1.1.1.1", runPolicy({}), "agent");
  assert.deepEqual(gate.snapshot(), { running: { kind: "agent", startedAt: "2026-10-22T10:00:00.000Z" }, runsToday: 1 });
  slot.release();
  assert.equal(gate.snapshot().running, null);
});

test("a paid route's body must be a JSON object: JSON null, arrays and primitives answer 400, an empty body is {}", async () => {
  const { parseJsonObjectBody } = await import("../src/lib/run-guard.mjs");
  assert.deepEqual(parseJsonObjectBody(""), { body: {}, refusal: null });
  assert.deepEqual(parseJsonObjectBody('{"segment":"s1"}'), { body: { segment: "s1" }, refusal: null });
  for (const text of ["null", "[]", '["s1"]', "3", '"s1"', "true"]) {
    assert.deepEqual(parseJsonObjectBody(text), { body: null, refusal: { status: 400, body: { error: "Request body must be a JSON object.", code: "invalid_body" } } }, text);
  }
  assert.deepEqual(parseJsonObjectBody("{"), { body: null, refusal: { status: 400, body: { error: "Request body must be JSON.", code: "invalid_json" } } });
});
