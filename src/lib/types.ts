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
export type Counterfactual = {
  change: string;
  segment: string;
  before: number;
  beforeResponses: number;
  after: number;
  afterResponses: number;
  afterCi: [number, number];
  deltaCi: [number, number];
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
  counterfactual?: Counterfactual;
};
export type AuditEvent =
  | { type: "stage"; stage: "resolve" | "qloo" | "personas" | "query" | "stats"; message: string }
  | { type: "place"; name: string; entityId: string; address?: string }
  | { type: "personas"; personas: Persona[] }
  | { type: "progress"; done: number; total: number; mentions: number }
  | { type: "done"; audit: Audit }
  | { type: "error"; message: string };
