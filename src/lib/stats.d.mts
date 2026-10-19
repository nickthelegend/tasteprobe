import type { SegmentResult } from "./types";

export type Observation = { segment: string; personaId?: string; brand: boolean; recommended: string[] };

export function bootstrapInterval(values: boolean[], iterations?: number, seed?: number): [number, number];
export function summarizeObservations(observations: Observation[]): SegmentResult[];
