import { seededRandom, slug } from "./stats.mjs";

const STOP_WORDS = new Set(["the", "a", "an", "restaurant", "cafe", "bar", "and"]);

export function normalizeName(value) {
  return String(value)
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]s\b/g, "")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value) {
  return normalizeName(value).split(" ").filter((token) => token && !STOP_WORDS.has(token));
}

function containsSequence(haystack, needle) {
  if (!needle.length || needle.length > haystack.length) return false;
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((token, offset) => haystack[start + offset] === token)) return true;
  }
  return false;
}

// True when an extracted entity name refers to the target brand. "The Bombay Canteen, Lower Parel" and
// "Bombay Canteen" match; a bare generic word such as "Canteen" does not.
export function matchesBrand(entity, brand) {
  const entityTokens = tokens(entity);
  const brandTokens = tokens(brand);
  if (!entityTokens.length || !brandTokens.length) return normalizeName(entity) === normalizeName(brand) && normalizeName(brand) !== "";
  if (containsSequence(entityTokens, brandTokens)) return true;
  return entityTokens.length >= 2 && containsSequence(brandTokens, entityTokens) && entityTokens.length / brandTokens.length >= 0.6;
}

function placeText(item) {
  const properties = item?.properties ?? {};
  return [properties.address, properties.geocode?.city, properties.geocode?.name, properties.geocode?.admin1_region]
    .filter((value) => typeof value === "string").join(" ");
}

// True when a Qloo place's address or geocode names the city (word match after normalising).
export function placeInCity(item, city) {
  const needle = normalizeName(city);
  return Boolean(needle) && ` ${normalizeName(placeText(item))} `.includes(` ${needle} `);
}

function describePlace(item) {
  const where = item?.properties?.address ?? item?.properties?.geocode?.city ?? "no address";
  return `${item?.name ?? "unnamed"} (${where})`;
}

// Picks the Qloo /search result for the venue. Only places in the requested city qualify; if none
// does, this throws and lists what Qloo did find instead of auditing a namesake in another city.
export function pickPlace(candidates, brand, city) {
  const list = (Array.isArray(candidates) ? candidates : []).filter((item) => item && (item.entity_id ?? item.id));
  if (!list.length) throw new Error(`Qloo found no place called “${brand}”. Try the exact listing name as it appears on maps.`);
  const local = list.filter((item) => placeInCity(item, city));
  const match = local.find((item) => matchesBrand(item.name ?? "", brand)) ?? local[0];
  if (!match) {
    const shown = list.slice(0, 5).map(describePlace).join("; ");
    throw new Error(`Qloo has no “${brand}” in ${city}. It found ${list.length} listing${list.length === 1 ? "" : "s"} elsewhere: ${shown}. Check the city spelling or use the exact listing name.`);
  }
  return { id: String(match.entity_id ?? match.id), name: match.name ?? brand, address: match.properties?.address, cityMatched: true };
}

// Segment names for personas built from urn:entity affinities (when the key refuses urn:tag).
export const ENTITY_SEGMENT_LABELS = {
  artist: "Music taste", brand: "Brand taste", movie: "Film taste", book: "Book taste",
  tv_show: "TV taste", podcast: "Podcast taste", place: "Place taste",
};

// "urn:tag:genre:restaurant" → "Restaurant genre"; "urn:entity:artist" → "Music taste"; unknown
// shapes fall back to a readable label.
export function segmentLabel(subtype) {
  const entity = /^urn:entity:([a-z_]+)$/.exec(String(subtype ?? ""));
  if (entity) return ENTITY_SEGMENT_LABELS[entity[1]] ?? `${entity[1].replace(/_/g, " ")} taste`.replace(/^./, (letter) => letter.toUpperCase());
  const parts = String(subtype ?? "").replace(/^urn:tag:/, "").split(":").filter(Boolean);
  if (!parts.length) return "General taste";
  const [kind, ...rest] = parts;
  const words = [...rest, kind].join(" ").replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Qloo tag insights responses have shifted shape between API versions; accept the known variants.
export function parseQlooTags(payload) {
  const list = payload?.results?.tags ?? payload?.results?.entities ?? payload?.tags ?? [];
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const tags = [];
  for (const item of list) {
    const id = item?.tag_id ?? item?.id ?? item?.entity_id;
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const affinity = [item?.query?.affinity, item?.affinity, item?.query?.popularity].find((value) => typeof value === "number");
    const subtype = item?.subtype ?? item?.type ?? (Array.isArray(item?.types) ? item.types[0] : undefined) ?? "";
    tags.push({ id: String(id), name, affinity, subtype: String(subtype) });
  }
  return tags;
}

// Cross-domain entities from /v2/insights with filter.type=urn:entity:<type>. Documented shape:
// results.entities[] with entity_id and name (docs.qloo.com/reference/insights-with-location-use-case);
// query.affinity is read when present. Not yet seen from a live call.
export const CROSS_DOMAIN_TYPES = ["artist", "brand", "movie", "book"];

export function parseQlooEntities(payload) {
  const list = payload?.results?.entities ?? payload?.entities ?? [];
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const entities = [];
  for (const item of list) {
    const id = item?.entity_id ?? item?.id;
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const affinity = [item?.query?.affinity, item?.affinity].find((value) => typeof value === "number");
    entities.push({ id: String(id), name, affinity });
  }
  return entities;
}

// filter.type=urn:demographics (docs.qloo.com/reference/demographics-use-case) returns
// results.demographics[] items with query.age and query.gender maps of bucket -> affinity score.
// Scores are averaged over the returned items. Not yet seen from a live call.
export function parseQlooDemographics(payload) {
  const list = payload?.results?.demographics;
  if (!Array.isArray(list) || !list.length) return null;
  const average = (field) => {
    const totals = new Map();
    let items = 0;
    for (const item of list) {
      const map = item?.query?.[field];
      if (!map || typeof map !== "object") continue;
      items++;
      for (const [bucket, score] of Object.entries(map)) if (typeof score === "number") totals.set(bucket, (totals.get(bucket) ?? 0) + score);
    }
    return items ? [...totals.entries()].map(([bucket, score]) => ({ bucket, score: score / items })).sort((a, b) => b.score - a.score) : [];
  };
  const age = average("age");
  const gender = average("gender");
  return age.length || gender.length ? { age, gender } : null;
}

export function groupTags(tags, maxSegments = 6) {
  const groups = new Map();
  for (const tag of tags) {
    const label = segmentLabel(tag.subtype);
    groups.set(label, [...(groups.get(label) ?? []), tag]);
  }
  return [...groups.entries()]
    .map(([name, items]) => ({ name, tags: [...items].sort((a, b) => (b.affinity ?? 0) - (a.affinity ?? 0)) }))
    .sort((a, b) => b.tags.length - a.tags.length || a.name.localeCompare(b.name))
    .slice(0, maxSegments);
}

function weightedPick(candidates, random) {
  const weights = candidates.map((tag) => Math.max(0.05, tag.affinity ?? 0.5));
  let target = random() * weights.reduce((total, weight) => total + weight, 0);
  for (let index = 0; index < candidates.length; index++) {
    target -= weights[index];
    if (target <= 0) return candidates[index];
  }
  return candidates[candidates.length - 1];
}

export const MIN_PERSONAS_PER_SEGMENT = 8;
export const MAX_SEGMENTS = 6;
export const PERSONA_SEED = 7;

// A segment needs at least 8 personas for its interval to mean anything, so N personas allow at
// most floor(N / 8) segments (and never more than 6).
export function maxSegmentsFor(personaCount) {
  return Math.max(1, Math.min(MAX_SEGMENTS, Math.floor(personaCount / MIN_PERSONAS_PER_SEGMENT)));
}

// Each persona is anchored on one Qloo tag (its segment) and blended with up to two other tags,
// sampled by affinity from the remaining segments, so profiles read like people rather than single tags.
// Personas rotate through the segments, so every segment gets floor(count / segments) or one more.
// `crossDomain` (optional) maps an entity type ("artist", "movie", ...) to Qloo entities with
// affinity to the venue; each persona then also names one or two of them, picked by affinity.
export function buildPersonas(tags, count, seed = PERSONA_SEED, crossDomain = {}) {
  const segments = groupTags(tags, maxSegmentsFor(count));
  if (!segments.length) return [];
  const random = seededRandom(seed);
  const personas = [];
  for (let index = 0; index < count; index++) {
    const segment = segments[index % segments.length];
    const primary = segment.tags[Math.floor(index / segments.length) % segment.tags.length];
    const others = segments.filter((item) => item !== segment).flatMap((item) => item.tags);
    const pool = others.length ? others : segment.tags.filter((tag) => tag !== primary);
    const secondary = [];
    while (secondary.length < 2 && pool.length > secondary.length) {
      const pick = weightedPick(pool.filter((tag) => !secondary.includes(tag)), random);
      secondary.push(pick);
    }
    const domains = CROSS_DOMAIN_TYPES.filter((type) => crossDomain[type]?.length);
    const extras = [];
    for (let offset = 0; offset < Math.min(2, domains.length); offset++) {
      const type = domains[(index + offset) % domains.length];
      const pick = weightedPick(crossDomain[type], random);
      extras.push({ type, id: pick.id, name: pick.name, affinity: pick.affinity });
    }
    personas.push({
      id: `p${String(index + 1).padStart(3, "0")}`,
      segment: segment.name,
      segmentId: slug(segment.name),
      affinities: [primary, ...secondary],
      ...(extras.length ? { crossDomain: extras } : {}),
    });
  }
  return personas;
}

const DOMAIN_WORDS = { artist: "the music of", brand: "the brand", movie: "the film", book: "the book", tv_show: "the TV show", podcast: "the podcast", place: "places like" };

// A tag reads as its name ("Craft Cocktails"); an urn:entity affinity says what kind of thing it
// is ("the film The Lunchbox"), so the prompt reads like a person.
function affinityPhrase(tag) {
  const entity = /^urn:entity:([a-z_]+)$/.exec(String(tag.subtype ?? ""));
  return entity && DOMAIN_WORDS[entity[1]] ? `${DOMAIN_WORDS[entity[1]]} ${tag.name}` : tag.name;
}

// The tested assistant never sees the target brand: naming it would bias the measurement.
export function personaPrompt(persona, category, city) {
  const [primary, ...rest] = persona.affinities.map(affinityPhrase);
  const extra = rest.length ? `, and I also like ${rest.join(" and ")}` : "";
  const outside = persona.crossDomain?.length
    ? ` Outside of food and drink I love ${persona.crossDomain.map((item) => `${DOMAIN_WORDS[item.type] ?? ""} ${item.name}`.trim()).join(" and ")}.`
    : "";
  return `I live in ${city}. I'm really into ${primary}${extra}.${outside} Recommend up to 5 ${category} places in ${city} that fit my taste. Give a numbered list with each place's name and one sentence on why it suits me.`;
}

// Placebo arm: a neutral sentence that names the brand but says nothing about taste. It is injected
// exactly like the fix copy, so fix − placebo isolates the copy from mere exposure to the name.
export function placeboCopy(brand, category, city) {
  return `${brand} is a ${category} in ${city}.`;
}

export function counterfactualPrompt(persona, category, city, brand, change) {
  return `${personaPrompt(persona, category, city)}\n\nContext retrieved from the web while answering:\n"${brand}: ${change}"`;
}
