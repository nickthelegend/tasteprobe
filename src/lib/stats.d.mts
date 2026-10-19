import type { SegmentResult } from "./types";

export type Observation = { segment: string; personaId?: string; brand: boolean; recommended: string[] };

export function seededRandom(seed?: number): () => number;
export function bootstrapInterval(values: (boolean | number)[], iterations?: number, seed?: number): [number, number];
export function clusteredBootstrapInterval(rows: { cluster?: string; value: number }[], iterations?: number, seed?: number): [number, number];
export function bootstrapDifference(before: (boolean | number)[], after: (boolean | number)[], iterations?: number, seed?: number): [number, number];
export function slug(value: string): string;
export function summarizeObservations(observations: Observation[]): SegmentResult[];
