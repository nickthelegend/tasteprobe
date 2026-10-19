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

// "urn:tag:genre:restaurant" → "Restaurant genre"; unknown shapes fall back to a readable label.
export function segmentLabel(subtype) {
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

// Each persona is anchored on one Qloo tag (its segment) and blended with up to two other tags,
// sampled by affinity from the remaining segments, so profiles read like people rather than single tags.
export function buildPersonas(tags, count, seed = 7) {
  const segments = groupTags(tags);
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
    personas.push({
      id: `p${String(index + 1).padStart(3, "0")}`,
      segment: segment.name,
      segmentId: slug(segment.name),
      affinities: [primary, ...secondary],
    });
  }
  return personas;
}

// The tested assistant never sees the target brand: naming it would bias the measurement.
export function personaPrompt(persona, category, city) {
  const [primary, ...rest] = persona.affinities.map((tag) => tag.name);
  const extra = rest.length ? `, and I also like ${rest.join(" and ")}` : "";
  return `I live in ${city}. I'm really into ${primary}${extra}. Recommend up to 5 ${category} places in ${city} that fit my taste. Give a numbered list with each place's name and one sentence on why it suits me.`;
}

export function counterfactualPrompt(persona, category, city, brand, change) {
  return `${personaPrompt(persona, category, city)}\n\nContext retrieved from the web while answering:\n"${brand}: ${change}"`;
}
