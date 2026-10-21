import type { ArmSummary, LiftSummary, SegmentResult } from "./types";

export type Observation = { segment: string; personaId?: string; brand: boolean; recommended: string[] };
export type FailureLike = { segment: string; personaId?: string; kind: "assistant" | "unparseable" | "extraction" };

export function seededRandom(seed?: number): () => number;
export function bootstrapInterval(values: (boolean | number)[], iterations?: number, seed?: number): [number, number];
export function clusteredBootstrapInterval(rows: { cluster?: string; value: number }[], iterations?: number, seed?: number): [number, number];
export function bootstrapDifference(before: (boolean | number)[], after: (boolean | number)[], iterations?: number, seed?: number): [number, number];
export type ClusterRow = { cluster?: string; value: number };
export const Z_95: number;
export function wilsonInterval(successes: number, n: number, z?: number): [number, number];
export function designEffect(rows: ClusterRow[]): { deff: number; clusters: number; responses: number; effectiveN: number };
export function shareInterval(rows: ClusterRow[], z?: number): [number, number];
export function pairedBootstrapDifference(control: ClusterRow[], treatment: ClusterRow[], iterations?: number, seed?: number): [number, number];
export function unpairedBootstrapDifference(control: ClusterRow[], treatment: ClusterRow[], iterations?: number, seed?: number): [number, number];
export function shareOf(rows: ClusterRow[]): number;
export function slug(value: string): string;
export function summarizeObservations(observations: Observation[], failures?: FailureLike[]): SegmentResult[];

type ArmRows = { rows: { personaId: string; brand: boolean }[]; failed: number };
export function compareArms(input: { baseline: ArmRows; placebo: ArmRows; fix: ArmRows }): {
  arms: { baseline: ArmSummary; placebo: ArmSummary; fix: ArmSummary };
  lift: { fixVsPlacebo: LiftSummary; fixVsBaseline: LiftSummary; placeboVsBaseline: LiftSummary };
};
