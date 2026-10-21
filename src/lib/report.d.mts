import type { Audit, SegmentResult } from "./types";

export type RawFile = { name: string; bytes: number; sha256: string; matchesRecorded?: boolean };
export function recompute(audit: Audit, responses: unknown): { overall: SegmentResult | undefined; segments: SegmentResult[] };
export function buildReport(input: { audit: Audit; responses: unknown; rawFiles: RawFile[]; mode: "live" | "replay"; recordedAt: string; renderedAt: string; runtime: string }): Record<string, unknown>;
export function renderReportHtml(report: unknown): string;
