import { NextResponse } from "next/server";
import { checkJsonContentType, checkRunToken, clientAddress, runPolicy, sharedRunGate, type Refusal, type RunPolicy } from "./run-guard.mjs";

// The spend guard as the three paid routes use it. See src/lib/run-guard.mjs for the rules.
export function refuse(refusal: Refusal) {
  const retry = typeof refusal.body.retryAfterSeconds === "number" ? { "retry-after": String(refusal.body.retryAfterSeconds) } : undefined;
  return NextResponse.json(refusal.body, { status: refusal.status, headers: retry });
}

// Run token, then Content-Type. Returns the policy, or the refusal to send.
export function openRun(request: Request): { policy: RunPolicy; ip: string; refusal: null } | { refusal: NextResponse } {
  const policy = runPolicy();
  const refusal = checkRunToken(request.headers, policy) ?? checkJsonContentType(request.headers);
  if (refusal) return { refusal: refuse(refusal) };
  return { policy, ip: clientAddress(request.headers), refusal: null };
}

// Out of runs for this address or for today? Spends nothing.
export function quotaRefusal(ip: string, policy: RunPolicy) {
  const refusal = sharedRunGate().checkQuota(ip, policy);
  return refusal ? refuse(refusal) : null;
}

// Takes the one run slot (429 when a flight is already pouring) and spends one run.
export function startRun(ip: string, policy: RunPolicy, kind: "audit" | "fix" | "agent"): { release: () => void } | { refusal: NextResponse } {
  const slot = sharedRunGate().start(ip, policy, kind);
  return "status" in slot ? { refusal: refuse(slot) } : slot;
}
