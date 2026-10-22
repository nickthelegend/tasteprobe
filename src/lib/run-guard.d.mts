import type { AgentCaps } from "./agent-core.mjs";

export type RunPolicy = { token: string | null; maxPersonas: number; runsPerIpPerHour: number; dailyRuns: number; agentCaps: AgentCaps };
export type PublicRunPolicy = { locked: boolean; maxPersonas: number; runsPerIpPerHour: number; dailyRuns: number; agentCaps: AgentCaps; oneAtATime: true };
export type Refusal = { status: number; body: { error: string; code: string; [key: string]: unknown } };
type HeaderReader = { get(name: string): string | null };
export const HARD_MAX_PERSONAS: number;
export const DEFAULT_RUNS_PER_IP_PER_HOUR: number;
export const DEFAULT_DAILY_RUNS: number;
export const DEFAULT_AGENT_CAPS: AgentCaps;
export const RUN_TOKEN_HEADER: string;
export function runPolicy(env?: Record<string, string | undefined>): RunPolicy;
export function publicPolicy(policy: RunPolicy): PublicRunPolicy;
export function checkRunToken(headers: HeaderReader, policy: RunPolicy): Refusal | null;
export function checkJsonContentType(headers: HeaderReader): Refusal | null;
export function checkPersonaCap(personaCount: number, policy: RunPolicy): Refusal | null;
export function clientAddress(headers: HeaderReader): string;
export class RunGate {
  constructor(now?: () => number);
  checkQuota(ip: string, policy: RunPolicy): Refusal | null;
  start(ip: string, policy: RunPolicy, kind: string): Refusal | { release: () => void };
}
export function sharedRunGate(): RunGate;
