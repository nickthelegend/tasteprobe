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
  provenance: "live" | "synthetic" | "unrecorded";
  venue: { brand: string; category: string; city: string; address: string | null; qlooEntityId: string };
  createdAt: string;
  durationSeconds: number;
  personas: number;
  personaSource: "urn:tag" | "urn:entity";
  personaSourceNote: string | null;
  tagScope: { city: number; global: number } | null;
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
    best: { copy: string; personas: number; lift: number | null; liftCi: Interval } | null;
    search: { personas: number; looks: number; candidates: number } | null;
    confirmation: { mode: "holdout" | "rerun"; personas: number; lift: number | null; liftCi: Interval; passed: boolean } | null;
    budget: AgentBudgetSummary; createdAt: string;
  }[];
  extraction: { model: string; inputTokens: number; outputTokens: number; estimatedCostUsd: number | null };
  reproducibility: NonNullable<Audit["meta"]> | null;
};
export function buildReportModel(audit: Audit): ReportModel;
export type Provenance = "live" | "synthetic" | "unrecorded";
export function provenanceOf(audit: Pick<Audit, "live" | "_fixture"> | null | undefined): Provenance;
export const PROVENANCE_TEXT: Record<Provenance, string>;
export function personaSourceOf(audit: Pick<Audit, "personaSource"> | null | undefined): "urn:tag" | "urn:entity";
export function personaSourceText(source: "urn:tag" | "urn:entity"): string;
export function tagScopeText(scope: { city: number; global: number } | null | undefined): string;
export type AuditListing = {
  id: string; brand: string; city: string; category: string; createdAt: string; share: number | null; answers: number; personas: number;
  personaSource: "urn:tag" | "urn:entity"; origin: "web" | "cli" | "mcp" | null; provenance: Provenance;
};
export function summarizeAuditListing(audit: Audit): AuditListing;
export const LISTING_PAGE: number;
export const LISTING_MAX_PAGE: number;
export function listAudits(audits: Audit[], options?: { featuredId?: string | null; limit?: number; offset?: number }): { items: (AuditListing & { featured: boolean })[]; total: number; live: number; featuredId: string | null };
export function reportText(model: ReportModel): string;
