export type TasteTag = { id: string; name: string; affinity?: number; subtype: string };
export type CrossDomainSignal = { type: string; id: string; name: string; affinity?: number };
export type Persona = { id: string; segment: string; segmentId: string; affinities: TasteTag[]; crossDomain?: CrossDomainSignal[] };
export type QlooDemographics = { age: { bucket: string; score: number }[]; gender: { bucket: string; score: number }[] };
// Cross-domain Qloo signals. Parameter names follow docs.qloo.com; response parsing is
// unverified until the first live run, and each call's error is kept instead of failing the audit.
export type QlooSignals = {
  domains: { type: string; entities: string[]; error?: string }[];
  demographics: QlooDemographics | null;
  demographicsError?: string;
};
export type Competitor = { name: string; mentions: number; share: number };
export type SegmentResult = {
  id: string;
  name: string;
  personas: number;
  responses: number;
  // responses + calls that produced no usable answer; failed is split by cause.
  attempted: number;
  failed: { assistant: number; unparseable: number; extraction: number };
  brandMentions: number;
  share: number;
  ci: [number, number];
  competitors: Competitor[];
};
export type Usage = { inputTokens: number; outputTokens: number };
export type ArmSummary = { share: number; mentions: number; responses: number; failed: number; ci: [number, number] };
export type LiftSummary = { delta: number; ci: [number, number] };
// One fix attempt: baseline, placebo and fix arms run concurrently on the same personas.
export type Counterfactual = {
  id: string;
  attempt: number;
  source: "fix";
  segment: string;
  personas: number;
  change: string;
  rationale: string;
  placebo: string;
  arms: { baseline: ArmSummary; placebo: ArmSummary; fix: ArmSummary };
  lift: { fixVsPlacebo: LiftSummary; fixVsBaseline: LiftSummary; placeboVsBaseline: LiftSummary };
  model: string;
  createdAt: string;
};
export type AgentCandidateSummary = {
  id: string;
  copy: string;
  rationale: string;
  personas: number;
  placeboShare: number | null;
  fixShare: number | null;
  lift: number | null;
  liftCi: [number, number] | null;
  failed: number;
};
export type AgentBudgetSummary = { tries: number; turns: number; assistantCalls: number; nemotronCalls: number; inputTokens: number; outputTokens: number; usd: number; priced: boolean };
// One run of the tool-calling fix agent (placebo vs fix probes only; see src/lib/agent.ts).
export type AgentRun = {
  id: string;
  segment: string;
  model: string;
  stopReason: string;
  stopDetail: string;
  best: AgentCandidateSummary | null;
  candidates: AgentCandidateSummary[];
  budget: AgentBudgetSummary;
  limits: { maxTries: number; maxAssistantCalls: number; maxUsd: number | null; maxNemotronTokens: number; maxTurns: number };
  steps: number;
  createdAt: string;
};
export type AgentEvent =
  | { type: "start"; runId: string; segment: string; model: string; limits: AgentRun["limits"] }
  | { type: "step"; turn: number; text: string; reasoningChars: number; toolCalls: string[]; usage: Usage; costUsd: number | null; budget: AgentBudgetSummary }
  | { type: "tool"; turn: number; name: string; args: Record<string, unknown>; ok: boolean; summary: string }
  | { type: "stop"; reason: string; detail: string }
  | { type: "done"; run: AgentRun }
  | { type: "error"; message: string };
export type Audit = {
  id: string;
  brand: string;
  qlooEntityId: string;
  qlooAddress?: string;
  category: string;
  city: string;
  createdAt: string;
  personas: Persona[];
  qlooSignals?: QlooSignals;
  overall: SegmentResult;
  segments: SegmentResult[];
  modelSegments: { model: string; segments: SegmentResult[] }[];
  systems: string[];
  responseCount: number;
  failedResponses: number;
  failedByKind?: { assistant: number; unparseable: number; extraction: number };
  // Nemotron extraction vs a deterministic numbered-list parser, per assistant.
  extractionCheck?: { model: string; answers: number; listed: number; brandDisagreements: number; setDisagreements: number; brandDisagreementRate: number | null; setDisagreementRate: number | null }[];
  // Top rivals looked up in Qloo /search: verified = a matching place in the city.
  rivalChecks?: { name: string; status: "verified" | "unverified"; qlooId?: string; detail?: string }[];
  extractionModel: string;
  extractionUsage: Usage;
  estimatedExtractionCostUsd: number | null;
  durationMs: number;
  counterfactuals?: Counterfactual[];
  agentRuns?: AgentRun[];
};
export type AuditEvent =
  | { type: "stage"; stage: "resolve" | "qloo" | "personas" | "query" | "stats"; message: string }
  | { type: "place"; name: string; entityId: string; address?: string }
  | { type: "personas"; personas: Persona[] }
  | { type: "answer"; personaId: string; segmentId: string; answered: number; mentioned: number; failed: number; rivals: string[] }
  | { type: "progress"; done: number; total: number; mentions: number }
  | { type: "done"; audit: Audit }
  | { type: "error"; message: string };
