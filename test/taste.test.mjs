import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPersonas, counterfactualPrompt, matchesBrand, parseQlooTags, personaPrompt, segmentLabel } from "../src/lib/taste.mjs";

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
  const personas = buildPersonas(tags, 12);
  assert.equal(personas.length, 12);
  assert.deepEqual(personas, buildPersonas(tags, 12));
  const segments = new Set(personas.map((persona) => persona.segment));
  assert.equal(segments.size, 3);
  for (const persona of personas) {
    assert.equal(persona.affinities.length, 3);
    assert.equal(new Set(persona.affinities.map((tag) => tag.id)).size, 3);
    assert.equal(persona.affinities[0].subtype && segmentLabel(persona.affinities[0].subtype), persona.segment);
  }
  assert.deepEqual(buildPersonas([], 10), []);
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
