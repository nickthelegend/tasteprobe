export type TasteTag = { id: string; name: string; affinity?: number; subtype: string };
export type Persona = { id: string; segment: string; segmentId: string; affinities: TasteTag[] };
export type Competitor = { name: string; mentions: number; share: number };
export type SegmentResult = {
  id: string;
  name: string;
  personas: number;
  responses: number;
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
  source: "fix" | "agent";
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
export type Audit = {
  id: string;
  brand: string;
  qlooEntityId: string;
  qlooAddress?: string;
  category: string;
  city: string;
  createdAt: string;
  personas: Persona[];
  overall: SegmentResult;
  segments: SegmentResult[];
  modelSegments: { model: string; segments: SegmentResult[] }[];
  systems: string[];
  responseCount: number;
  failedResponses: number;
  extractionModel: string;
  extractionUsage: Usage;
  estimatedExtractionCostUsd: number | null;
  durationMs: number;
  counterfactuals?: Counterfactual[];
};
export type AuditEvent =
  | { type: "stage"; stage: "resolve" | "qloo" | "personas" | "query" | "stats"; message: string }
  | { type: "place"; name: string; entityId: string; address?: string }
  | { type: "personas"; personas: Persona[] }
  | { type: "answer"; personaId: string; segmentId: string; answered: number; mentioned: number; failed: number; rivals: string[] }
  | { type: "progress"; done: number; total: number; mentions: number }
  | { type: "done"; audit: Audit }
  | { type: "error"; message: string };
