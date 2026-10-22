// Spend guard for the three paid routes (POST /api/audits, /api/audits/<id>/fix, /api/audits/<id>/agent).
// Every check runs before the provider-key check, so a locked or over-limit request never reaches
// Qloo, Nebius or an assistant:
//   1. run token: when TASTEPROBE_RUN_TOKEN is set, the request must send it in the
//      X-TasteProbe-Run-Token header (a header, not a cookie, so a cross-site form cannot send it).
//      In production (NODE_ENV=production, as the Dockerfile sets) with no token, paid routes
//      answer 503 "Setup required: TASTEPROBE_RUN_TOKEN" unless TASTEPROBE_RUNS_OPEN=1 is set;
//   2. Content-Type must be application/json (a cross-site text/plain form POST is refused);
//   3. persona cap (TASTEPROBE_MAX_PERSONAS) and agent budget caps, clamped on the server;
//   4. per-IP token bucket (TASTEPROBE_RUNS_PER_IP_PER_HOUR) and a daily quota per instance
//      (TASTEPROBE_DAILY_RUNS). The address comes only from the header named in
//      TASTEPROBE_TRUSTED_IP_HEADER (x-real-ip on Railway); without it every caller shares one bucket;
//   5. one run at a time per process ("a flight is already pouring"), with a wall-clock deadline
//      (TASTEPROBE_RUN_DEADLINE_SECONDS, default 900): past it the run's signal aborts and the slot
//      is freed (see run-deadline.mjs).
// Refusals are readable 401/403/415/400/429 JSON answers, never a success. Reads stay open.
import { timingSafeEqual } from "node:crypto";
import { DEFAULT_CAPS } from "./agent-core.mjs";
import { RunDeadlineError } from "./run-deadline.mjs";

export const HARD_MAX_PERSONAS = 200;
export const DEFAULT_RUNS_PER_IP_PER_HOUR = 10;
export const DEFAULT_DAILY_RUNS = 100;
export const DEFAULT_RUN_DEADLINE_SECONDS = 900;
// The agent caps default to what the UI offers (AgentLoop: up to 5 copies and 480 assistant calls).
// A request can ask for less, never more; env variables can move them within the hard bounds in
// agent-core.mjs.
export const DEFAULT_AGENT_CAPS = DEFAULT_CAPS;
export const RUN_TOKEN_HEADER = "x-tasteprobe-run-token";
// The per-IP bucket map never holds more than this many addresses (least recently used go first).
export const MAX_BUCKETS = 10_000;
const UNTRUSTED_ADDRESS = "untrusted";

const positiveInt = (value, fallback, min, max) => {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

export function runPolicy(env = process.env) {
  const token = typeof env.TASTEPROBE_RUN_TOKEN === "string" && env.TASTEPROBE_RUN_TOKEN.trim() ? env.TASTEPROBE_RUN_TOKEN.trim() : null;
  const header = typeof env.TASTEPROBE_TRUSTED_IP_HEADER === "string" ? env.TASTEPROBE_TRUSTED_IP_HEADER.trim().toLowerCase() : "";
  // A production server with no token fails closed unless the owner opts in to open runs.
  const setupRequired = !token && env.NODE_ENV === "production" && env.TASTEPROBE_RUNS_OPEN !== "1" ? "TASTEPROBE_RUN_TOKEN" : null;
  const deadlineSeconds = positiveInt(env.TASTEPROBE_RUN_DEADLINE_SECONDS, DEFAULT_RUN_DEADLINE_SECONDS, 1, 86_400);
  return {
    token,
    setupRequired,
    trustedIpHeader: header || null,
    maxPersonas: positiveInt(env.TASTEPROBE_MAX_PERSONAS, HARD_MAX_PERSONAS, 8, HARD_MAX_PERSONAS),
    runsPerIpPerHour: positiveInt(env.TASTEPROBE_RUNS_PER_IP_PER_HOUR, DEFAULT_RUNS_PER_IP_PER_HOUR, 1, 10_000),
    dailyRuns: positiveInt(env.TASTEPROBE_DAILY_RUNS, DEFAULT_DAILY_RUNS, 1, 1_000_000),
    deadlineSeconds,
    deadlineMs: deadlineSeconds * 1000,
    agentCaps: {
      maxTries: positiveInt(env.TASTEPROBE_AGENT_MAX_TRIES, DEFAULT_AGENT_CAPS.maxTries, 1, 8),
      maxAssistantCalls: positiveInt(env.TASTEPROBE_AGENT_MAX_CALLS, DEFAULT_AGENT_CAPS.maxAssistantCalls, 4, 1000),
      maxNemotronTokens: positiveInt(env.TASTEPROBE_AGENT_MAX_TOKENS, DEFAULT_AGENT_CAPS.maxNemotronTokens, 10_000, 5_000_000),
      maxTurns: positiveInt(env.TASTEPROBE_AGENT_MAX_TURNS, DEFAULT_AGENT_CAPS.maxTurns, 2, 40),
    },
  };
}

// What /api/status may show: the caps and whether runs are locked, never the token.
export function publicPolicy(policy) {
  return { locked: policy.token !== null, setupRequired: policy.setupRequired ?? null, maxPersonas: policy.maxPersonas, runsPerIpPerHour: policy.runsPerIpPerHour, dailyRuns: policy.dailyRuns, deadlineSeconds: policy.deadlineSeconds, agentCaps: policy.agentCaps, oneAtATime: true };
}

const refusal = (status, code, error, extra = {}) => ({ status, body: { error, code, ...extra } });

function sameSecret(given, expected) {
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

// `headers` is a Fetch Headers object (or anything with get()).
export function checkRunToken(headers, policy) {
  if (policy.setupRequired) return refusal(503, "setup_required", "Setup required: TASTEPROBE_RUN_TOKEN. This production server has no run token, so paid runs are refused. Set TASTEPROBE_RUN_TOKEN (or TASTEPROBE_RUNS_OPEN=1 for a private server). Stored audits stay open to read.");
  if (!policy.token) return null;
  const given = headers.get(RUN_TOKEN_HEADER);
  if (!given) return refusal(401, "run_locked", "Runs are disabled on this server: it needs the run token (TASTEPROBE_RUN_TOKEN) in the X-TasteProbe-Run-Token header. Stored audits stay open to read.");
  if (!sameSecret(given, policy.token)) return refusal(403, "run_token_rejected", "The run token was rejected. Stored audits stay open to read.");
  return null;
}

export function checkJsonContentType(headers) {
  const type = (headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  return type === "application/json" ? null : refusal(415, "json_required", "Send the request as JSON (Content-Type: application/json).");
}

// A paid route's body as a JSON object. An empty body is {}; anything else must parse to an object
// (JSON null, an array or a primitive is refused), so a route never reads fields off null.
export function parseJsonObjectBody(text) {
  if (!String(text ?? "").trim()) return { body: {}, refusal: null };
  let value;
  try { value = JSON.parse(text); } catch { return { body: null, refusal: refusal(400, "invalid_json", "Request body must be JSON.") }; }
  return value && typeof value === "object" && !Array.isArray(value)
    ? { body: value, refusal: null }
    : { body: null, refusal: refusal(400, "invalid_body", "Request body must be a JSON object.") };
}

export function checkPersonaCap(personaCount, policy) {
  return personaCount > policy.maxPersonas
    ? refusal(400, "persona_cap", `This server allows at most ${policy.maxPersonas} personas per audit (TASTEPROBE_MAX_PERSONAS).`, { maxPersonas: policy.maxPersonas })
    : null;
}

// Client address for the per-IP bucket, read only from the header the deployment trusts
// (TASTEPROBE_TRUSTED_IP_HEADER): its proxy sets it, so a client cannot pick its own bucket. For
// X-Forwarded-For the last hop is used (the one the proxy appended). With no trusted header every
// caller shares one "untrusted" bucket, which fails closed.
export function clientAddress(headers, policy = {}) {
  const name = policy.trustedIpHeader;
  if (!name) return UNTRUSTED_ADDRESS;
  const hops = (headers.get(name) ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  return hops.length ? hops[hops.length - 1] : UNTRUSTED_ADDRESS;
}

const HOUR = 3_600_000;
const dayOf = (time) => new Date(time).toISOString().slice(0, 10);

// Process-wide run state: the one-at-a-time slot, per-IP token buckets and the daily count.
export class RunGate {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.running = null;
    this.buckets = new Map();
    this.day = dayOf(now());
    this.dailyCount = 0;
  }

  // The address's current bucket, refilled to now. Not stored: only start() stores a spent bucket.
  bucket(ip, policy) {
    const time = this.now();
    const capacity = policy.runsPerIpPerHour;
    const current = this.buckets.get(ip);
    if (!current) return { tokens: capacity, at: time };
    const tokens = Math.min(capacity, current.tokens + ((time - current.at) / HOUR) * capacity);
    // A bucket that is back to full is the same as no bucket: drop it so the map stays small.
    if (tokens >= capacity) this.buckets.delete(ip);
    return { tokens, at: time };
  }

  // Stores a spent bucket as the most recently used; evicts the least recently used past MAX_BUCKETS.
  spend(ip, policy) {
    const next = this.bucket(ip, policy);
    this.buckets.delete(ip);
    this.buckets.set(ip, { tokens: next.tokens - 1, at: next.at });
    while (this.buckets.size > MAX_BUCKETS) this.buckets.delete(this.buckets.keys().next().value);
  }

  // What /api/status shows: what is running (kind and start time) and the runs spent today.
  snapshot() {
    this.rollDay();
    return { running: this.running ? { kind: this.running.kind, startedAt: new Date(this.running.at).toISOString() } : null, runsToday: this.dailyCount };
  }

  rollDay() {
    const today = dayOf(this.now());
    if (today !== this.day) { this.day = today; this.dailyCount = 0; }
  }

  // Refuses when this address or the instance is out of runs. Spends nothing.
  checkQuota(ip, policy) {
    this.rollDay();
    if (this.dailyCount >= policy.dailyRuns) return refusal(429, "daily_quota", `This server has used its ${policy.dailyRuns} runs for today (TASTEPROBE_DAILY_RUNS). Stored audits stay open to read.`);
    const bucket = this.bucket(ip, policy);
    if (bucket.tokens < 1) {
      const waitMinutes = Math.ceil(((1 - bucket.tokens) / policy.runsPerIpPerHour) * 60);
      return refusal(429, "rate_limited", `Too many runs from this address: ${policy.runsPerIpPerHour} per hour (TASTEPROBE_RUNS_PER_IP_PER_HOUR). Try again in about ${waitMinutes} min.`, { retryAfterSeconds: waitMinutes * 60 });
    }
    return null;
  }

  // Takes the one run slot and spends one run from the address and the day. Returns
  // { release, signal } or a 429 refusal. `release` is idempotent. When the policy's deadline
  // passes first, `signal` aborts with a RunDeadlineError and the slot is released.
  start(ip, policy, kind) {
    const quota = this.checkQuota(ip, policy);
    if (quota) return quota;
    if (this.running) return refusal(429, "busy", `A flight is already pouring on this server (${this.running.kind} started ${Math.round((this.now() - this.running.at) / 1000)}s ago). Try again when it finishes.`);
    const slot = { kind, at: this.now() };
    this.running = slot;
    this.spend(ip, policy);
    this.dailyCount += 1;
    let released = false;
    const controller = new AbortController();
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(timer);
      if (this.running === slot) this.running = null;
    };
    const deadlineMs = policy.deadlineMs ?? DEFAULT_RUN_DEADLINE_SECONDS * 1000;
    const timer = setTimeout(() => {
      controller.abort(new RunDeadlineError(kind, deadlineMs / 1000));
      release();
    }, deadlineMs);
    timer.unref?.();
    return { release, signal: controller.signal };
  }
}

// One gate per server process, shared by every route bundle (and kept across dev reloads).
export function sharedRunGate() {
  const key = Symbol.for("tasteprobe.runGate");
  globalThis[key] ??= new RunGate();
  return globalThis[key];
}
