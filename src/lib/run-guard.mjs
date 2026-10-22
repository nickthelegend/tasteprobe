// Spend guard for the three paid routes (POST /api/audits, /api/audits/<id>/fix, /api/audits/<id>/agent).
// Every check runs before the provider-key check, so a locked or over-limit request never reaches
// Qloo, Nebius or an assistant:
//   1. run token: when TASTEPROBE_RUN_TOKEN is set, the request must send it in the
//      X-TasteProbe-Run-Token header (a header, not a cookie, so a cross-site form cannot send it);
//   2. Content-Type must be application/json (a cross-site text/plain form POST is refused);
//   3. persona cap (TASTEPROBE_MAX_PERSONAS) and agent budget caps, clamped on the server;
//   4. per-IP token bucket (TASTEPROBE_RUNS_PER_IP_PER_HOUR) and a daily quota per instance
//      (TASTEPROBE_DAILY_RUNS);
//   5. one run at a time per process ("a flight is already pouring").
// Refusals are readable 401/403/415/400/429 JSON answers, never a success. Reads stay open.
import { timingSafeEqual } from "node:crypto";
import { DEFAULT_CAPS } from "./agent-core.mjs";

export const HARD_MAX_PERSONAS = 200;
export const DEFAULT_RUNS_PER_IP_PER_HOUR = 10;
export const DEFAULT_DAILY_RUNS = 100;
// The agent caps default to what the UI offers (AgentLoop: up to 5 copies and 480 assistant calls).
// A request can ask for less, never more; env variables can move them within the hard bounds in
// agent-core.mjs.
export const DEFAULT_AGENT_CAPS = DEFAULT_CAPS;
export const RUN_TOKEN_HEADER = "x-tasteprobe-run-token";

const positiveInt = (value, fallback, min, max) => {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

export function runPolicy(env = process.env) {
  const token = typeof env.TASTEPROBE_RUN_TOKEN === "string" && env.TASTEPROBE_RUN_TOKEN.trim() ? env.TASTEPROBE_RUN_TOKEN.trim() : null;
  return {
    token,
    maxPersonas: positiveInt(env.TASTEPROBE_MAX_PERSONAS, HARD_MAX_PERSONAS, 8, HARD_MAX_PERSONAS),
    runsPerIpPerHour: positiveInt(env.TASTEPROBE_RUNS_PER_IP_PER_HOUR, DEFAULT_RUNS_PER_IP_PER_HOUR, 1, 10_000),
    dailyRuns: positiveInt(env.TASTEPROBE_DAILY_RUNS, DEFAULT_DAILY_RUNS, 1, 1_000_000),
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
  return { locked: policy.token !== null, maxPersonas: policy.maxPersonas, runsPerIpPerHour: policy.runsPerIpPerHour, dailyRuns: policy.dailyRuns, agentCaps: policy.agentCaps, oneAtATime: true };
}

const refusal = (status, code, error, extra = {}) => ({ status, body: { error, code, ...extra } });

function sameSecret(given, expected) {
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

// `headers` is a Fetch Headers object (or anything with get()).
export function checkRunToken(headers, policy) {
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

export function checkPersonaCap(personaCount, policy) {
  return personaCount > policy.maxPersonas
    ? refusal(400, "persona_cap", `This server allows at most ${policy.maxPersonas} personas per audit (TASTEPROBE_MAX_PERSONAS).`, { maxPersonas: policy.maxPersonas })
    : null;
}

// Client address for the per-IP bucket. X-Real-IP, else the last X-Forwarded-For hop (the one the
// platform's proxy appended; earlier hops are whatever the client sent), else "local".
export function clientAddress(headers) {
  const real = headers.get("x-real-ip");
  if (real && real.trim()) return real.trim();
  const forwarded = (headers.get("x-forwarded-for") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  return forwarded.length ? forwarded[forwarded.length - 1] : "local";
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

  bucket(ip, policy) {
    const time = this.now();
    const capacity = policy.runsPerIpPerHour;
    const current = this.buckets.get(ip) ?? { tokens: capacity, at: time };
    const tokens = Math.min(capacity, current.tokens + ((time - current.at) / HOUR) * capacity);
    const next = { tokens, at: time };
    this.buckets.set(ip, next);
    return next;
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
  // { release } or a 429 refusal. `release` is idempotent.
  start(ip, policy, kind) {
    const quota = this.checkQuota(ip, policy);
    if (quota) return quota;
    if (this.running) return refusal(429, "busy", `A flight is already pouring on this server (${this.running.kind} started ${Math.round((this.now() - this.running.at) / 1000)}s ago). Try again when it finishes.`);
    const slot = { kind, at: this.now() };
    this.running = slot;
    this.bucket(ip, policy).tokens -= 1;
    this.dailyCount += 1;
    let released = false;
    return { release: () => { if (!released) { released = true; if (this.running === slot) this.running = null; } } };
  }
}

// One gate per server process, shared by every route bundle (and kept across dev reloads).
export function sharedRunGate() {
  const key = Symbol.for("tasteprobe.runGate");
  globalThis[key] ??= new RunGate();
  return globalThis[key];
}
