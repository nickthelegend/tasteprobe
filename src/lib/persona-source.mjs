// Where the personas' taste signals come from, with the fallback the Qloo hackathon host needs.
//
// The Qloo Agentic Hackathon Developer Guide (docs.qloo.com/reference/qloo-llm-hackathon-developer-guide,
// checked 2026-10-22) lists only urn:entity:artist, book, brand, destination, movie, person, place,
// podcast, tv_show and video_game as supported filter.type values, and says an unsupported type
// answers 403. So the audit asks for urn:tag first (the Taste Analysis call) and, on a 403 for
// urn:tag, builds the personas from urn:entity affinities instead: each entity type becomes one
// taste segment. Which path ran is recorded on the audit as `personaSource`.
//
// `call(path, params)` must return the parsed JSON or throw what readQlooResponse throws
// (QlooHttpError). providers.ts passes its live Qloo caller; nothing here does I/O itself.
import { QlooHttpError } from "./qloo.mjs";
import { matchesBrand, parseQlooEntities, parseQlooTags } from "./taste.mjs";

// The urn:entity types that become persona segments when urn:tag is refused. All are on the
// hackathon host's supported list.
export const PERSONA_ENTITY_TYPES = ["artist", "brand", "movie", "book", "tv_show", "podcast", "place"];
// Every filter.type the hackathon guide lists as supported (urn:tag is not among them).
export const HACKATHON_ENTITY_TYPES = ["artist", "book", "brand", "destination", "movie", "person", "place", "podcast", "tv_show", "video_game"];
// Fewer city-scoped tags than this and the venue's global neighbourhood is added.
export const MIN_CITY_TAGS = 6;
const ENTITIES_PER_TYPE = "15";

const message = (error) => (error instanceof Error ? error.message : String(error)).slice(0, 200);

// True when Qloo answered 403 for this filter.type (the "unsupported type" answer).
export function isFilterTypeRefused(error, filterType) {
  return error instanceof QlooHttpError && error.status === 403 && (!filterType || error.filterType === filterType);
}

// Entity payloads (type -> /v2/insights response) as persona tags. The venue itself is dropped
// from the place results, so a persona never names the brand under test.
export function entityTagsFromPayloads(payloads, { entityId, venueName }) {
  const tags = [];
  for (const type of PERSONA_ENTITY_TYPES) {
    if (!payloads[type]) continue;
    for (const entity of parseQlooEntities(payloads[type])) {
      if (type === "place" && (entity.id === entityId || (venueName && (matchesBrand(entity.name, venueName) || matchesBrand(venueName, entity.name))))) continue;
      tags.push({ id: entity.id, name: entity.name, affinity: entity.affinity, subtype: `urn:entity:${type}` });
    }
  }
  return tags;
}

async function fromTags(call, { entityId, city }) {
  const base = { "filter.type": "urn:tag", "signal.interests.entities": entityId, take: "50" };
  const local = await call("/v2/insights", { ...base, "signal.location.query": city });
  let tags = parseQlooTags(local);
  const raw = [{ scope: "city", payload: local }];
  if (tags.length < MIN_CITY_TAGS) {
    // Sparse local coverage: fall back to the place's global taste neighbourhood and say so in the cache.
    const global = await call("/v2/insights", base);
    raw.push({ scope: "global", payload: global });
    const seen = new Set(tags.map((tag) => tag.id));
    tags = [...tags, ...parseQlooTags(global).filter((tag) => !seen.has(tag.id))];
  }
  if (!tags.length) throw new Error("Qloo returned no taste tags for this place. Check the place name or try a better-known listing.");
  return { source: "urn:tag", tags, raw, entityResults: null, tagRefusal: null };
}

async function fromEntities(call, { entityId, city, venueName }, tagRefusal) {
  const payloads = {};
  const entityResults = {};
  const raw = [{ type: "urn:tag", refused: true, detail: tagRefusal }];
  await Promise.all(PERSONA_ENTITY_TYPES.map(async (type) => {
    try {
      const payload = await call("/v2/insights", { "filter.type": `urn:entity:${type}`, "signal.interests.entities": entityId, "signal.location.query": city, take: ENTITIES_PER_TYPE });
      raw.push({ type, payload });
      payloads[type] = payload;
      entityResults[type] = { entities: parseQlooEntities(payload) };
    } catch (error) {
      entityResults[type] = { entities: [], error: message(error) };
    }
  }));
  const tags = entityTagsFromPayloads(payloads, { entityId, venueName });
  if (!tags.length) {
    const errors = PERSONA_ENTITY_TYPES.filter((type) => entityResults[type].error).map((type) => `${type}: ${entityResults[type].error}`);
    throw new Error(`Qloo refused urn:tag for this key (403) and returned no urn:entity affinities for this place either${errors.length ? ` (${errors.join("; ")})` : ""}. Try a better-known listing.`);
  }
  return { source: "urn:entity", tags, raw, entityResults, tagRefusal };
}

// urn:tag first; on a 403 for urn:tag, urn:entity affinities. Any other error is not a refusal and
// is thrown as is (a 401, an outage, an empty result).
export async function collectPersonaSignals(call, { entityId, city, venueName }) {
  try {
    return await fromTags(call, { entityId, city });
  } catch (error) {
    if (!isFilterTypeRefused(error, "urn:tag")) throw error;
    return fromEntities(call, { entityId, city, venueName }, message(error));
  }
}

// One preflight line: does this key get urn:tag for the resolved place? `outcome` is { ok: true }
// (Qloo answered 200) or { ok: false, error } (what readQlooResponse threw).
export function tagSupportLine(placeName, outcome) {
  if (outcome.ok) return `Qloo urn:tag for ${placeName}: supported; personas come from taste tags`;
  if (isFilterTypeRefused(outcome.error, "urn:tag")) return `Qloo urn:tag for ${placeName}: refused (403); personas will be built from urn:entity affinities (${PERSONA_ENTITY_TYPES.join(", ")})`;
  throw outcome.error;
}
