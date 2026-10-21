import type { AgentBudgetSummary, Audit, QlooDemographics } from "./types";

type Interval = [number, number] | null;
export type ReportSegment = {
  id: string; name: string; personas: number; mentions: number; answers: number; attempted: number;
  dropped: { assistant: number; unparseable: number; extraction: number };
  share: number | null; ci: Interval; rivals: { name: string; mentions: number; share: number | null }[];
};
type ReportArm = { share: number | null; mentions: number; answers: number; failed: number; ci: Interval } | null;
type ReportLift = { delta: number | null; ci: Interval; clearsZero: boolean } | null;
export type ReportModel = {
  id: string;
  venue: { brand: string; category: string; city: string; address: string | null; qlooEntityId: string };
  createdAt: string;
  durationSeconds: number;
  personas: number;
  assistants: string[];
  overall: ReportSegment;
  segments: ReportSegment[];
  byAssistant: { model: string; segments: ReportSegment[] }[];
  answers: { usable: number; dropped: number; attempted: number; droppedByKind: { assistant: number; unparseable: number; extraction: number } };
  rivalChecks: { name: string; status: "verified" | "unverified"; detail: string | null }[];
  extractionCheck: { model: string; listed: number; brandDisagreementRate: number | null; setDisagreementRate: number | null }[];
  qlooSignals: { domains: { type: string; entities: string[]; error: string | null }[]; demographics: QlooDemographics | null; demographicsError: string | null } | null;
  fixes: {
    attempt: number; segment: string; personas: number; copy: string; rationale: string; placebo: string; model: string; createdAt: string;
    arms: { baseline: ReportArm; placebo: ReportArm; fix: ReportArm };
    lift: { fixVsPlacebo: ReportLift; placeboVsBaseline: ReportLift; fixVsBaseline: ReportLift };
  }[];
  agentRuns: {
    segment: string; model: string; stopReason: string; stopDetail: string; candidates: number;
    best: { copy: string; personas: number; lift: number | null; liftCi: Interval } | null; budget: AgentBudgetSummary; createdAt: string;
  }[];
  extraction: { model: string; inputTokens: number; outputTokens: number; estimatedCostUsd: number | null };
  reproducibility: NonNullable<Audit["meta"]> | null;
};
export function buildReportModel(audit: Audit): ReportModel;
export function summarizeAuditListing(audit: Audit): { id: string; brand: string; city: string; createdAt: string; share: number | null; answers: number };
export function reportText(model: ReportModel): string;
