import type { Persona, TasteTag } from "./types";

export function normalizeName(value: string): string;
export function matchesBrand(entity: string, brand: string): boolean;
export function placeInCity(item: unknown, city: string): boolean;
export function pickPlace(candidates: unknown, brand: string, city: string): { id: string; name: string; address?: string; cityMatched: true };
export function segmentLabel(subtype: string | undefined): string;
export function parseQlooTags(payload: unknown): TasteTag[];
export function groupTags(tags: TasteTag[], maxSegments?: number): { name: string; tags: TasteTag[] }[];
export const MIN_PERSONAS_PER_SEGMENT: number;
export const MAX_SEGMENTS: number;
export const PERSONA_SEED: number;
export function maxSegmentsFor(personaCount: number): number;
export function placeboCopy(brand: string, category: string, city: string): string;
export function buildPersonas(tags: TasteTag[], count: number, seed?: number): Persona[];
export function personaPrompt(persona: Persona, category: string, city: string): string;
export function counterfactualPrompt(persona: Persona, category: string, city: string, brand: string, change: string): string;
