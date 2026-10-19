import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapInterval, summarizeObservations } from "../src/lib/stats.mjs";

test("bootstrap interval is reproducible and contains the observed rate", () => {
  const observations = [true, false, true, false, true, false];
  const interval = bootstrapInterval(observations);
  assert.deepEqual(interval, bootstrapInterval(observations));
  assert.ok(interval[0] <= 0.5);
  assert.ok(interval[1] >= 0.5);
});

test("summarizes mention share, unique profiles, responses, and competitor rank", () => {
  const result = summarizeObservations([
    { segment: "Music fans", personaId: "one", brand: true, recommended: ["Taste", "Rival"] },
    { segment: "Music fans", personaId: "one", brand: false, recommended: ["Rival"] },
    { segment: "Music fans", personaId: "two", brand: false, recommended: ["Rival"] },
    { segment: "Food explorers", personaId: "three", brand: false, recommended: ["Other"] },
  ]);
  const music = result.find((row) => row.name === "Music fans");
  assert.equal(music.share, 1 / 3);
  assert.equal(music.profileCount, 2);
  assert.equal(music.responses, 3);
  assert.equal(music.competitors[0].name, "Rival");
  assert.deepEqual(result.find((row) => row.name === "Food explorers").ci, [0, 0]);
});
