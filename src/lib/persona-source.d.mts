import type { TasteTag } from "./types";
import type { QlooEntity } from "./taste.mjs";

export type PersonaSource = "urn:tag" | "urn:entity";
export type QlooCall = (path: string, params: Record<string, string>) => Promise<any>;
export type PersonaSignals = {
  source: PersonaSource;
  tags: TasteTag[];
  raw: unknown[];
  entityResults: Record<string, { entities: QlooEntity[]; error?: string }> | null;
  tagRefusal: string | null;
  // How many persona signals are city-scoped and how many came from Qloo's global neighbourhood.
  tagScope: { city: number; global: number };
};
export const PERSONA_ENTITY_TYPES: string[];
export const HACKATHON_ENTITY_TYPES: string[];
export const MIN_CITY_TAGS: number;
export function isFilterTypeRefused(error: unknown, filterType?: string): boolean;
export function entityTagsFromPayloads(payloads: Record<string, unknown>, venue: { entityId: string; venueName?: string }): TasteTag[];
export function collectPersonaSignals(call: QlooCall, venue: { entityId: string; city: string; venueName?: string }): Promise<PersonaSignals>;
export function tagSupportLine(placeName: string, outcome: { ok: true } | { ok: false; error: unknown }): string;
