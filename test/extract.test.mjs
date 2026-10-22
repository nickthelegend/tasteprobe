import assert from "node:assert/strict";
import test from "node:test";
import { crossCheck, parseNumberedList, summarizeCrossCheck } from "../src/lib/extract.mjs";
import { summarizeObservations } from "../src/lib/stats.mjs";
import { pickPlace, placeInCity } from "../src/lib/taste.mjs";

// Doc-shaped Qloo /search results (fields as documented: entity_id, name, properties.address);
// written for this test, not recorded from a live call.
const canteenMumbai = { entity_id: "A1", name: "The Bombay Canteen", properties: { address: "Kamala Mills, Lower Parel, Mumbai, Maharashtra 400013, India" } };
const canteenLondon = { entity_id: "B2", name: "Bombay Canteen", properties: { address: "12 Example Street, London, UK" } };
const otherMumbai = { entity_id: "C3", name: "Canteen Café", properties: { address: "Bandra West, Mumbai, India" } };

test("pickPlace returns the in-city listing and prefers a name match", () => {
  assert.equal(pickPlace([canteenLondon, otherMumbai, canteenMumbai], "The Bombay Canteen", "Mumbai").id, "A1");
  assert.equal(pickPlace([canteenLondon, canteenMumbai], "The Bombay Canteen", "mumbai").cityMatched, true);
});

test("pickPlace never falls back to a namesake in another city; it lists the candidates", () => {
  assert.throws(() => pickPlace([canteenLondon], "The Bombay Canteen", "Mumbai"), (error) => {
    assert.match(error.message, /no “The Bombay Canteen” in Mumbai/);
    assert.match(error.message, /Bombay Canteen \(12 Example Street, London, UK\)/);
    return true;
  });
  assert.throws(() => pickPlace([], "Nowhere", "Mumbai"), /found no place called “Nowhere”/);
  assert.throws(() => pickPlace([{ name: "No id" }], "No id", "Mumbai"), /found no place/);
});

test("pickPlace refuses to audit a different venue in the same city when no listing name matches", () => {
  assert.throws(() => pickPlace([otherMumbai], "The Bombay Canteen", "Mumbai"), (error) => {
    assert.match(error.message, /no listing named “The Bombay Canteen” in Mumbai/);
    assert.match(error.message, /Canteen Café \(Bandra West, Mumbai, India\)/);
    return true;
  });
  // Rival verification may take the closest in-city listing; verifyRival then reports the mismatch.
  assert.equal(pickPlace([otherMumbai], "The Bombay Canteen", "Mumbai", { strict: false }).id, "C3");
});

test("city matching is a word match, not a substring", () => {
  assert.ok(placeInCity(canteenMumbai, "Mumbai"));
  assert.ok(!placeInCity({ properties: { address: "Navi Mumbaikar Road, Pune" } }, "Mumbai"));
  assert.ok(placeInCity({ properties: { geocode: { city: "São Paulo" } } }, "Sao Paulo"));
  assert.ok(!placeInCity({}, "Mumbai"));
});

test("numbered-list parser reads names from common list styles", () => {
  const answer = [
    "Here are some places you might like:",
    "",
    "1. **The Bombay Canteen** – modern Indian plates with a playful bar.",
    "2) Masque (Mahalaxmi): tasting menus built on local produce.",
    "3. Bastian - seafood with a big crowd.",
    "### 4. [Americano](https://example.com) — Italian-leaning brasserie",
    "**5. O Pedro**: Goan flavours.",
    "Enjoy!",
  ].join("\n");
  assert.deepEqual(parseNumberedList(answer), ["The Bombay Canteen", "Masque", "Bastian", "Americano", "O Pedro"]);
  assert.deepEqual(parseNumberedList("No list here, just prose about The Bombay Canteen."), []);
});

test("cross-check flags disagreements between the list parser and Nemotron", () => {
  const list = ["The Bombay Canteen", "Masque"];
  assert.deepEqual(crossCheck(["Bombay Canteen", "Masque"], list, "The Bombay Canteen"), { listed: true, brandAgrees: true, setAgrees: true, onlyInList: [], onlyInExtraction: [] });
  const missed = crossCheck(["Masque"], list, "The Bombay Canteen");
  assert.equal(missed.brandAgrees, false);
  assert.deepEqual(missed.onlyInList, ["The Bombay Canteen"]);
  assert.equal(crossCheck(["Masque"], [], "The Bombay Canteen").listed, false);
});

test("cross-check summary reports a disagreement rate per assistant over answers with lists", () => {
  const rows = [
    { model: "a", answer: "1. The Bombay Canteen\n2. Masque", entities: ["The Bombay Canteen", "Masque"] },
    { model: "a", answer: "1. The Bombay Canteen\n2. Masque", entities: ["Masque"] },
    { model: "a", answer: "Try Masque.", entities: ["Masque"] },
    { model: "b", answer: "1. Masque", entities: ["Masque"] },
  ];
  const [a, b] = summarizeCrossCheck(rows, "The Bombay Canteen");
  assert.equal(a.model, "a");
  assert.equal(a.answers, 3);
  assert.equal(a.listed, 2);
  assert.equal(a.brandDisagreements, 1);
  assert.equal(a.brandDisagreementRate, 0.5);
  assert.equal(b.brandDisagreementRate, 0);
});

test("segment summaries count failed and unparseable answers outside the denominator", () => {
  const [segment] = summarizeObservations(
    [
      { segment: "Bars", personaId: "p1", brand: true, recommended: [] },
      { segment: "Bars", personaId: "p2", brand: false, recommended: [] },
    ],
    [
      { segment: "Bars", personaId: "p3", kind: "unparseable" },
      { segment: "Bars", personaId: "p3", kind: "assistant" },
    ],
  );
  assert.equal(segment.responses, 2);
  assert.equal(segment.attempted, 4);
  assert.deepEqual(segment.failed, { assistant: 1, unparseable: 1, extraction: 0 });
  assert.equal(segment.share, 0.5);
  assert.equal(segment.personas, 3);
  const [empty] = summarizeObservations([], [{ segment: "Cafes", personaId: "p9", kind: "extraction" }]);
  assert.equal(empty.responses, 0);
  assert.equal(empty.share, 0);
  assert.deepEqual(empty.ci, [0, 1]);
});

test("the evidence panel's per-answer flag uses the city like the server: 'Trishna' and 'Trishna Mumbai' agree in Mumbai", async () => {
  const { answerCheckNote } = await import("../src/lib/extract.mjs");
  assert.equal(crossCheck(["Trishna"], ["Trishna Mumbai"], "Trishna", "Mumbai").brandAgrees, true);
  assert.equal(crossCheck(["Trishna"], ["Trishna Mumbai"], "Trishna").brandAgrees, false);
  const note = answerCheckNote(["Trishna"], ["Trishna Mumbai"], "Trishna", "Mumbai");
  assert.ok(note === null || !note.includes("on whether you were recommended"), String(note));
  assert.equal(answerCheckNote(["Trishna", "Bastian"], ["Trishna", "Bastian"], "Trishna", "Mumbai"), null);
  assert.equal(answerCheckNote(["Bastian"], ["Trishna", "Bastian"], "Trishna", "Mumbai"), "List parser disagrees on whether you were recommended · only in the list: Trishna");
});
