import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapDifference, bootstrapInterval, clusteredBootstrapInterval, summarizeObservations } from "../src/lib/stats.mjs";

test("bootstrap interval is reproducible and contains the observed rate", () => {
  const observations = [true, false, true, false, true, false];
  const interval = bootstrapInterval(observations);
  assert.deepEqual(interval, bootstrapInterval(observations));
  assert.ok(interval[0] <= 0.5 && interval[1] >= 0.5);
});

test("bootstrap interval collapses for constant data and handles empty input", () => {
  assert.deepEqual(bootstrapInterval([true, true, true]), [1, 1]);
  assert.deepEqual(bootstrapInterval([]), [0, 0]);
  assert.deepEqual(clusteredBootstrapInterval([]), [0, 0]);
});

test("bootstrap interval narrows as sample size grows", () => {
  const small = bootstrapInterval(Array.from({ length: 10 }, (_, index) => index % 2 === 0));
  const large = bootstrapInterval(Array.from({ length: 400 }, (_, index) => index % 2 === 0));
  assert.ok(large[1] - large[0] < small[1] - small[0]);
});

test("clustered bootstrap is wider than row bootstrap when responses within a persona agree", () => {
  const rows = [];
  for (let persona = 0; persona < 12; persona++) {
    for (let model = 0; model < 3; model++) rows.push({ cluster: `p${persona}`, value: persona % 3 === 0 ? 1 : 0 });
  }
  const clustered = clusteredBootstrapInterval(rows);
  const naive = bootstrapInterval(rows.map((row) => row.value));
  assert.ok(clustered[1] - clustered[0] > naive[1] - naive[0]);
});

test("difference interval excludes zero for a large real shift and straddles zero for no shift", () => {
  const before = Array.from({ length: 60 }, (_, index) => index < 6);
  const after = Array.from({ length: 60 }, (_, index) => index < 40);
  const [low, high] = bootstrapDifference(before, after);
  assert.ok(low > 0 && high < 1);
  const [flatLow, flatHigh] = bootstrapDifference(before, before);
  assert.ok(flatLow < 0 && flatHigh > 0);
});

test("summarizes share, unique personas, responses and competitor rank", () => {
  const result = summarizeObservations([
    { segment: "Music fans", personaId: "one", brand: true, recommended: ["Rival", "rival"] },
    { segment: "Music fans", personaId: "one", brand: false, recommended: ["Rival"] },
    { segment: "Music fans", personaId: "two", brand: false, recommended: ["RIVAL", "Other"] },
    { segment: "Food explorers", personaId: "three", brand: false, recommended: ["Other"] },
  ]);
  const music = result.find((row) => row.name === "Music fans");
  assert.equal(music.share, 1 / 3);
  assert.equal(music.personas, 2);
  assert.equal(music.responses, 3);
  assert.equal(music.competitors[0].name, "Rival");
  assert.equal(music.competitors[0].mentions, 3);
  assert.equal(music.competitors[0].share, 1);
  assert.deepEqual(result.find((row) => row.name === "Food explorers").ci, [0, 0]);
});
