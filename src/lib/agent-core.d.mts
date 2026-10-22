import type { Usage } from "./types";

export type AgentLimits = { maxTries: number; maxAssistantCalls: number; maxUsd: number | null; maxNemotronTokens: number; maxTurns: number };
export type AgentBudget = { tries: number; turns: number; assistantCalls: number; nemotronCalls: number; inputTokens: number; outputTokens: number; usd: number; priced: boolean };
export type Prices = { input: number; output: number } | null;
export type CandidateRow = { personaId: string; brand: boolean };
export type Candidate = { id: string; copy: string; rationale: string; placeboRows: CandidateRow[]; fixRows: CandidateRow[]; personasProbed: string[]; failed: number };
export type CandidateStats = {
  personas: number; placeboShare: number | null; fixShare: number | null; lift: number | null;
  liftCi: [number, number] | null; placeboCi: [number, number] | null; fixCi: [number, number] | null; failed: number;
};
export type StopReason = "lift_confirmed" | "confirmation_failed" | "budget_assistant_calls" | "budget_nemotron_tokens" | "budget_usd" | "budget_turns" | "budget_tries" | "agent_finished";
export type ConfirmationPlan = { mode: "holdout" | "rerun"; selection: string[]; confirmation: string[] };
export type Confirmation = {
  candidateId: string; mode: "holdout" | "rerun"; personas: number; placeboShare: number | null; fixShare: number | null;
  lift: number | null; liftCi: [number, number] | null; failed: number; passed: boolean;
};

export const DEFAULT_LIMITS: AgentLimits;
export type AgentCaps = { maxTries: number; maxAssistantCalls: number; maxNemotronTokens: number; maxTurns: number };
export const DEFAULT_CAPS: AgentCaps;
export function normalizeLimits(input?: Partial<Record<keyof AgentLimits, unknown>>, caps?: AgentCaps): AgentLimits;
export function createBudget(): AgentBudget;
export function tokenCostUsd(usage: Usage, prices: Prices): number | null;
export function chargeBudget(budget: AgentBudget, spend: { assistantCalls?: number; nemotronCalls?: number; usage?: Usage; tries?: number; turns?: number }, prices: Prices): AgentBudget;
export function budgetExhausted(budget: AgentBudget, limits: AgentLimits): StopReason | null;
export function affordablePersonas(budget: AgentBudget, limits: AgentLimits, requested: number, assistants: number): number;
export function validateCopy(copy: unknown): string | null;
export function parseToolArguments(raw: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; error: string };
export function candidateStats(candidate: Pick<Candidate, "placeboRows" | "fixRows" | "personasProbed" | "failed">): CandidateStats;
export function selectBest(candidates: Candidate[]): { candidate: Candidate; stats: CandidateStats & { lift: number; liftCi: [number, number] } } | null;
export function planConfirmation(personaIds: string[]): ConfirmationPlan;
export function confirmationCalls(plan: ConfirmationPlan, assistants: number): number;
export function screenedCandidate(candidates: Candidate[], selectionSize: number): ReturnType<typeof selectBest>;
export function confirmationResult(input: { candidateId: string; mode: "holdout" | "rerun"; placeboRows: CandidateRow[]; fixRows: CandidateRow[]; failed?: number }): Confirmation;
export function stopDecision(candidates: Candidate[], budget: AgentBudget, limits: AgentLimits, selectionSize: number, confirmation?: Confirmation | null): { stop: boolean; reason: StopReason | null; confirm: string | null };
export const STOP_REASONS: Record<StopReason, string>;
export function nextPersonas(segmentPersonaIds: string[], probedIds: string[], count: number): string[];
export function qlooFilterTypes(hackathonHost: boolean): string[];
export type QlooToolArgs = { filterType: string | null; entity: { kind: "venue" } | { kind: "rival"; id: string; name: string }; location: string };
export function validateQlooToolArgs(
  args: Record<string, unknown> | undefined,
  context: { rivals?: { name: string; qlooId: string }[]; hackathonHost?: boolean; city: string },
): { ok: true; value: QlooToolArgs } | { ok: false; error: string };
