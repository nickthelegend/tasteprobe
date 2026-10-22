import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPersonas, counterfactualPrompt, matchesBrand, maxSegmentsFor, parseQlooDemographics, parseQlooEntities, parseQlooTags, personaPrompt, placeboCopy, segmentLabel } from "../src/lib/taste.mjs";

// Doc-shaped fixture (follows the documented /v2/insights tag shape), not a recorded live response.
const insights = JSON.parse(readFileSync(new URL("./fixtures/qloo-tag-insights.json", import.meta.url), "utf8"));

test("brand matching tolerates articles, punctuation, accents and branch suffixes", () => {
  assert.ok(matchesBrand("Bombay Canteen", "The Bombay Canteen"));
  assert.ok(matchesBrand("The Bombay Canteen (Lower Parel)", "The Bombay Canteen"));
  assert.ok(matchesBrand("Café Madras", "Cafe Madras"));
  assert.ok(matchesBrand("Trishna's", "Trishna"));
  assert.ok(matchesBrand("Bombay & Co", "Bombay and Co"));
});

test("brand matching rejects generic fragments and other venues", () => {
  assert.ok(!matchesBrand("Canteen", "The Bombay Canteen"));
  assert.ok(!matchesBrand("Bombay Brasserie", "The Bombay Canteen"));
  assert.ok(!matchesBrand("O Pedro", "The Bombay Canteen"));
  assert.ok(!matchesBrand("", "The Bombay Canteen"));
});

test("segment labels are readable", () => {
  assert.equal(segmentLabel("urn:tag:genre:restaurant"), "Restaurant genre");
  assert.equal(segmentLabel("urn:tag:keyword:media"), "Media keyword");
  assert.equal(segmentLabel(""), "General taste");
});

test("parses Qloo tag insights, deduplicates and keeps affinity", () => {
  const tags = parseQlooTags(insights);
  assert.equal(tags.length, 7);
  assert.equal(tags[0].name, "Cocktail Bar");
  assert.equal(typeof tags[0].affinity, "number");
  assert.deepEqual(parseQlooTags({}), []);
  assert.deepEqual(parseQlooTags({ results: { tags: "nope" } }), []);
});

test("builds deterministic personas that rotate segments and blend tags", () => {
  const tags = parseQlooTags(insights);
  const personas = buildPersonas(tags, 24);
  assert.equal(personas.length, 24);
  assert.deepEqual(personas, buildPersonas(tags, 24));
  const segments = new Set(personas.map((persona) => persona.segment));
  assert.equal(segments.size, 3);
  for (const persona of personas) {
    assert.equal(persona.affinities.length, 3);
    assert.equal(new Set(persona.affinities.map((tag) => tag.id)).size, 3);
    assert.equal(persona.affinities[0].subtype && segmentLabel(persona.affinities[0].subtype), persona.segment);
  }
  assert.deepEqual(buildPersonas([], 10), []);
});

test("every taste segment gets at least 8 personas: segments are capped at floor(personas / 8)", () => {
  assert.equal(maxSegmentsFor(8), 1);
  assert.equal(maxSegmentsFor(12), 1);
  assert.equal(maxSegmentsFor(16), 2);
  assert.equal(maxSegmentsFor(24), 3);
  assert.equal(maxSegmentsFor(200), 6);
  const tags = parseQlooTags(insights);
  for (const count of [8, 12, 16, 23, 24, 48]) {
    const sizes = new Map();
    for (const persona of buildPersonas(tags, count)) sizes.set(persona.segment, (sizes.get(persona.segment) ?? 0) + 1);
    assert.ok(sizes.size <= maxSegmentsFor(count), `${count} personas made ${sizes.size} segments`);
    for (const [segment, size] of sizes) assert.ok(size >= 8, `${count} personas: ${segment} has only ${size}`);
  }
});

test("persona prompt never leaks the target brand; counterfactual adds the change as context", () => {
  const [persona] = buildPersonas(parseQlooTags(insights), 1);
  const prompt = personaPrompt(persona, "modern Indian restaurant", "Mumbai");
  assert.match(prompt, /Mumbai/);
  assert.match(prompt, new RegExp(persona.affinities[0].name));
  assert.doesNotMatch(prompt, /Bombay Canteen/);
  const counterfactual = counterfactualPrompt(persona, "modern Indian restaurant", "Mumbai", "The Bombay Canteen", "Live jazz on Thursdays.");
  assert.ok(counterfactual.startsWith(prompt));
  assert.match(counterfactual, /The Bombay Canteen: Live jazz on Thursdays\./);
});

test("placebo copy names the brand neutrally and is injected exactly like the fix copy", () => {
  const [persona] = buildPersonas(parseQlooTags(insights), 8);
  const placebo = placeboCopy("The Bombay Canteen", "modern Indian restaurant", "Mumbai");
  assert.equal(placebo, "The Bombay Canteen is a modern Indian restaurant in Mumbai.");
  const fixPrompt = counterfactualPrompt(persona, "modern Indian restaurant", "Mumbai", "The Bombay Canteen", "Live jazz on Thursdays.");
  const placeboPrompt = counterfactualPrompt(persona, "modern Indian restaurant", "Mumbai", "The Bombay Canteen", placebo);
  const shared = (text) => text.slice(0, text.lastIndexOf(": "));
  assert.equal(shared(fixPrompt), shared(placeboPrompt));
});

// Doc-shaped fixtures (hand-written to the documented / community-reported shapes, not live data).
const artists = JSON.parse(readFileSync(new URL("./fixtures/qloo-entity-insights.json", import.meta.url), "utf8"));
const demographics = JSON.parse(readFileSync(new URL("./fixtures/qloo-demographics.json", import.meta.url), "utf8"));

test("parses cross-domain entity insights, deduplicates and keeps affinity", () => {
  const entities = parseQlooEntities(artists);
  assert.deepEqual(entities.map((item) => item.name), ["Prateek Kuhad", "Nucleya", "When Chai Met Toast"]);
  assert.equal(entities[0].affinity, 0.82);
  assert.equal(entities[2].affinity, 0.61);
  assert.deepEqual(parseQlooEntities({ results: {} }), []);
});

test("parses urn:demographics into averaged age and gender leans", () => {
  const parsed = parseQlooDemographics(demographics);
  assert.equal(parsed.age[0].bucket, "25_to_29");
  assert.ok(Math.abs(parsed.age[0].score - 0.3) < 1e-9);
  assert.equal(parsed.gender[0].bucket, "female");
  assert.equal(parseQlooDemographics({ results: { demographics: [] } }), null);
  assert.equal(parseQlooDemographics({}), null);
});

test("cross-domain signals are blended into personas and prompts without leaking the brand", () => {
  const tags = parseQlooTags(insights);
  const plain = buildPersonas(tags, 16);
  const blended = buildPersonas(tags, 16, 7, { artist: parseQlooEntities(artists), movie: [{ id: "M1", name: "The Lunchbox", affinity: 0.7 }] });
  assert.equal(plain[0].crossDomain, undefined);
  assert.deepEqual(blended.map((persona) => persona.segment), plain.map((persona) => persona.segment));
  for (const persona of blended) {
    assert.equal(persona.crossDomain.length, 2);
    assert.notEqual(persona.crossDomain[0].type, persona.crossDomain[1].type);
  }
  const prompt = personaPrompt(blended[0], "restaurant", "Mumbai");
  assert.match(prompt, /Outside of food and drink I love/);
  assert.match(prompt, new RegExp(blended[0].crossDomain[0].name));
  assert.doesNotMatch(prompt, /Bombay Canteen/);
  assert.doesNotMatch(personaPrompt(plain[0], "restaurant", "Mumbai"), /Outside of food/);
});

test("one-word brands match only themselves: 'The Table' is not 'Table Talk' or 'Kitchen Table'", () => {
  assert.equal(matchesBrand("Table Talk", "The Table"), false);
  assert.equal(matchesBrand("Kitchen Table", "The Table"), false);
  assert.equal(matchesBrand("Madras Bar", "Cafe Madras"), false);
  // The brand itself, with articles, a branch note or the city name, still counts.
  assert.equal(matchesBrand("The Table", "The Table"), true);
  assert.equal(matchesBrand("Table", "The Table"), true);
  assert.equal(matchesBrand("The Table, Colaba", "The Table"), true);
  assert.equal(matchesBrand("The Table (Colaba)", "The Table"), true);
  assert.equal(matchesBrand("The Table – Colaba", "The Table"), true);
  assert.equal(matchesBrand("The Table Mumbai", "The Table", { city: "Mumbai" }), true);
  assert.equal(matchesBrand("The Table Mumbai", "The Table"), false, "without the city, an extra word is another name");
  assert.equal(matchesBrand("Trishna, Fort", "Trishna"), true);
  assert.equal(matchesBrand("Trishna Kitchen", "Trishna"), false);
});

test("names in non-Latin scripts normalise and match", async () => {
  const { normalizeName, placeInCity } = await import("../src/lib/taste.mjs");
  assert.equal(normalizeName("すきやばし次郎"), "すきやばし次郎");
  assert.equal(matchesBrand("すきやばし次郎", "すきやばし次郎"), true);
  assert.equal(matchesBrand("すきやばし次郎 (本店)", "すきやばし次郎"), true);
  assert.equal(matchesBrand("鮨 さいとう", "すきやばし次郎"), false);
  assert.equal(matchesBrand("Café Москва", "Кафе Москва"), false);
  assert.equal(matchesBrand("Кафе Москва", "кафе москва"), true);
  assert.equal(matchesBrand("मुंबई कैफ़े", "मुंबई कैफ़े"), true);
  // A city in a script without spaces is found inside the address.
  assert.equal(placeInCity({ properties: { address: "東京都中央区銀座4-2-15" } }, "東京"), true);
  assert.equal(placeInCity({ properties: { address: "大阪府大阪市北区" } }, "東京"), false);
  assert.equal(placeInCity({ properties: { address: "12 Rue de Rivoli, Paris" } }, "Paris"), true);
});
