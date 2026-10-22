// The urn:tag -> urn:entity persona fallback. Qloo's answers come from hand-written, doc-shaped
// fixtures (test/fixtures/qloo-entity-segments.json, qloo-tag-insights.json) and go through the
// real readQlooResponse, so a 403 is the same QlooHttpError the live caller throws.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { collectPersonaSignals, entityTagsFromPayloads, isFilterTypeRefused, PERSONA_ENTITY_TYPES, tagSupportLine } from "../src/lib/persona-source.mjs";
import { readQlooResponse } from "../src/lib/qloo.mjs";
import { buildPersonas, maxSegmentsFor, personaPrompt, segmentLabel } from "../src/lib/taste.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/qloo-entity-segments.json", import.meta.url), "utf8"));
const tagInsights = readFileSync(new URL("./fixtures/qloo-tag-insights.json", import.meta.url), "utf8");
const venue = { entityId: fixture.venue.entityId, city: fixture.venue.city, venueName: fixture.venue.name };

// Answers each /v2/insights call from the fixtures through readQlooResponse and records every call.
function fixtureCaller({ tag }) {
  const calls = [];
  const call = async (path, params) => {
    calls.push(params);
    const type = params["filter.type"];
    let status = 200;
    let body;
    if (type === "urn:tag") ({ status, body } = tag);
    else {
      const entry = fixture.entities[type.replace("urn:entity:", "")];
      if (entry?._status) { status = entry._status; body = entry._body; }
      else body = JSON.stringify(entry ?? { success: true, results: { entities: [] } });
    }
    return readQlooResponse({ path, params, status, body });
  };
  return { call, calls };
}

test("a 403 for urn:tag switches the personas to urn:entity segments instead of failing the audit", async () => {
  const { call, calls } = fixtureCaller({ tag: fixture.tagRefusal });
  const signals = await collectPersonaSignals(call, venue);
  assert.equal(signals.source, "urn:entity");
  assert.match(signals.tagRefusal, /403 for filter\.type=urn:tag/);
  // One urn:tag call, then one call per persona entity type, each city-scoped on the venue.
  assert.equal(calls[0]["filter.type"], "urn:tag");
  assert.deepEqual(calls.slice(1).map((params) => params["filter.type"]).sort(), PERSONA_ENTITY_TYPES.map((type) => `urn:entity:${type}`).sort());
  for (const params of calls.slice(1)) {
    assert.equal(params["signal.interests.entities"], "VENUE-1");
    assert.equal(params["signal.location.query"], "Testville");
  }
  // A type the key refuses (podcast here) is recorded and skipped, not fatal.
  assert.match(signals.entityResults.podcast.error, /403 for filter\.type=urn:entity:podcast/);
  assert.deepEqual(signals.entityResults.podcast.entities, []);
  // The venue and its own branch never become a persona's taste.
  const names = signals.tags.map((tag) => tag.name);
  assert.ok(!names.includes("Fixture Canteen"));
  assert.ok(!names.includes("The Fixture Canteen, Branch Road"));
  assert.ok(names.includes("Synthetic Wine Bar"));
  assert.ok(signals.tags.every((tag) => tag.subtype.startsWith("urn:entity:")));
});

test("urn:entity personas keep at least 8 personas per segment, one segment per entity type", async () => {
  const { call } = fixtureCaller({ tag: fixture.tagRefusal });
  const { tags } = await collectPersonaSignals(call, venue);
  for (const count of [8, 16, 24, 48, 100]) {
    const personas = buildPersonas(tags, count);
    assert.equal(personas.length, count);
    const sizes = new Map();
    for (const persona of personas) sizes.set(persona.segment, (sizes.get(persona.segment) ?? 0) + 1);
    assert.ok(sizes.size >= 1 && sizes.size <= maxSegmentsFor(count), `${count} personas made ${sizes.size} segments`);
    for (const [segment, size] of sizes) assert.ok(size >= 8, `${count} personas: ${segment} has only ${size}`);
    for (const persona of personas) {
      assert.equal(persona.affinities.length, 3);
      assert.equal(segmentLabel(persona.affinities[0].subtype), persona.segment);
      // Anchor plus two from other segments.
      assert.ok(persona.affinities.slice(1).every((tag) => segmentLabel(tag.subtype) !== persona.segment || sizes.size === 1));
    }
  }
  const labels = new Set(buildPersonas(tags, 48).map((persona) => persona.segment));
  assert.deepEqual([...labels].sort(), ["Book taste", "Brand taste", "Film taste", "Music taste", "Place taste", "TV taste"]);
});

test("an urn:entity persona's prompt says what each taste is and never names the venue", async () => {
  const { call } = fixtureCaller({ tag: fixture.tagRefusal });
  const { tags } = await collectPersonaSignals(call, venue);
  for (const persona of buildPersonas(tags, 24)) {
    const prompt = personaPrompt(persona, "restaurant", "Testville");
    assert.doesNotMatch(prompt, /Fixture Canteen/);
    assert.match(prompt, /the music of |the brand |the film |the book |the TV show |places like /);
  }
  assert.equal(segmentLabel("urn:entity:tv_show"), "TV taste");
  assert.equal(segmentLabel("urn:entity:video_game"), "Video game taste");
});

test("when urn:tag works the personas still come from taste tags", async () => {
  const { call, calls } = fixtureCaller({ tag: { status: 200, body: tagInsights } });
  const signals = await collectPersonaSignals(call, venue);
  assert.equal(signals.source, "urn:tag");
  assert.equal(signals.tagRefusal, null);
  assert.equal(signals.entityResults, null);
  assert.ok(calls.every((params) => params["filter.type"] === "urn:tag"));
  assert.ok(signals.tags.length >= 6);
});

test("only a 403 on urn:tag is a refusal: a 401 or an outage still fails loudly", async () => {
  const rejected = fixtureCaller({ tag: { status: 401, body: "{}" } });
  await assert.rejects(collectPersonaSignals(rejected.call, venue), /401 \(key rejected\)/);
  assert.equal(rejected.calls.length, 1);
  const outage = fixtureCaller({ tag: { status: 502, body: "bad gateway" } });
  await assert.rejects(collectPersonaSignals(outage.call, venue), /returned 502: bad gateway/);
  assert.equal(isFilterTypeRefused(new Error("403"), "urn:tag"), false);
});

test("urn:tag refused and no urn:entity results either: a readable error naming each refusal", async () => {
  const call = async (path, params) => readQlooResponse({ path, params, status: 403, body: "not enabled" });
  await assert.rejects(collectPersonaSignals(call, venue), /refused urn:tag for this key \(403\) and returned no urn:entity affinities.*artist: Qloo \/v2\/insights returned 403/);
});

test("entity payloads drop the venue itself from the place segment", () => {
  const tags = entityTagsFromPayloads({ place: fixture.entities.place, artist: fixture.entities.artist }, { entityId: "VENUE-1", venueName: "Fixture Canteen" });
  assert.deepEqual(tags.filter((tag) => tag.subtype === "urn:entity:place").map((tag) => tag.name), ["Synthetic Wine Bar", "Synthetic Bakery"]);
  assert.equal(tags.filter((tag) => tag.subtype === "urn:entity:artist").length, 4);
});

test("the preflight line says whether this key gets urn:tag", () => {
  assert.equal(tagSupportLine("Fixture Canteen", { ok: true }), "Qloo urn:tag for Fixture Canteen: supported; personas come from taste tags");
  let refusal;
  try { readQlooResponse({ path: "/v2/insights", params: { "filter.type": "urn:tag" }, status: 403, body: fixture.tagRefusal.body }); } catch (error) { refusal = error; }
  assert.match(tagSupportLine("Fixture Canteen", { ok: false, error: refusal }), /^Qloo urn:tag for Fixture Canteen: refused \(403\); personas will be built from urn:entity affinities \(artist, brand, movie, book, tv_show, podcast, place\)$/);
  let unauthorised;
  try { readQlooResponse({ path: "/v2/insights", params: { "filter.type": "urn:tag" }, status: 401, body: "{}" }); } catch (error) { unauthorised = error; }
  assert.throws(() => tagSupportLine("Fixture Canteen", { ok: false, error: unauthorised }), /401/);
});
