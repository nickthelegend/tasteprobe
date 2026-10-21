import assert from "node:assert/strict";
import test from "node:test";
import {
  bootstrapDifference, bootstrapInterval, clusteredBootstrapInterval, designEffect, pairedBootstrapDifference,
  seededRandom, shareInterval, summarizeObservations, unpairedBootstrapDifference, wilsonInterval,
} from "../src/lib/stats.mjs";

test("bootstrap interval is reproducible and contains the observed rate", () => {
  const observations = [true, false, true, false, true, false];
  const interval = bootstrapInterval(observations);
  assert.deepEqual(interval, bootstrapInterval(observations));
  assert.ok(interval[0] <= 0.5 && interval[1] >= 0.5);
});

test("bootstrap helpers handle empty input", () => {
  assert.deepEqual(bootstrapInterval([]), [0, 0]);
  assert.deepEqual(clusteredBootstrapInterval([]), [0, 0]);
  assert.deepEqual(shareInterval([]), [0, 1]);
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

test("Wilson interval matches the closed form and never collapses at 0 or n", () => {
  const [low, high] = wilsonInterval(0, 12);
  assert.equal(low, 0);
  assert.ok(Math.abs(high - 0.2425) < 0.001, `upper ${high}`);
  const [fullLow, fullHigh] = wilsonInterval(12, 12);
  assert.equal(fullHigh, 1);
  assert.ok(fullLow < 0.8);
  const [midLow, midHigh] = wilsonInterval(5, 10);
  assert.ok(Math.abs(midLow - 0.2366) < 0.001 && Math.abs(midHigh - 0.7634) < 0.001);
});

test("0 of 12 answers gives an upper bound above 20%, not [0, 0]", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({ cluster: `p${index}`, value: 0 }));
  const [low, high] = shareInterval(rows);
  assert.equal(low, 0);
  assert.ok(high > 0.2, `upper bound ${high}`);
});

test("design effect counts personas when one persona's assistants always agree", () => {
  const agreeing = [];
  for (let persona = 0; persona < 12; persona++) for (let model = 0; model < 3; model++) agreeing.push({ cluster: `p${persona}`, value: persona % 3 === 0 ? 1 : 0 });
  const { deff, effectiveN } = designEffect(agreeing);
  assert.ok(deff > 2.5 && deff <= 3, `deff ${deff}`);
  assert.ok(Math.abs(effectiveN - 12) < 1.5);
  const independent = agreeing.map((row, index) => ({ cluster: `row${index}`, value: row.value }));
  assert.equal(designEffect(independent).deff, 1);
  const clustered = shareInterval(agreeing);
  const naive = shareInterval(independent);
  assert.ok(clustered[1] - clustered[0] > naive[1] - naive[0]);
});

// 8 personas × 3 assistants per run. Rows within a persona either share one draw (correlated) or are
// independent binomial draws. The interval should cover the true share at least 90% of the time.
function coverage(trueShare, sharedProbability, seed) {
  const random = seededRandom(seed);
  let covered = 0;
  const runs = 1000;
  for (let run = 0; run < runs; run++) {
    const rows = [];
    for (let persona = 0; persona < 8; persona++) {
      const shared = random() < trueShare ? 1 : 0;
      for (let model = 0; model < 3; model++) {
        const value = random() < sharedProbability ? shared : random() < trueShare ? 1 : 0;
        rows.push({ cluster: `p${persona}`, value });
      }
    }
    const [low, high] = shareInterval(rows);
    if (low <= trueShare && trueShare <= high) covered++;
  }
  return covered / runs;
}

test("coverage: 1000 binomial runs with 8 persona clusters cover p=0.03 and p=0.3 at least 90% of the time", () => {
  for (const trueShare of [0.03, 0.3]) {
    const independent = coverage(trueShare, 0, 101);
    const correlated = coverage(trueShare, 0.6, 202);
    assert.ok(independent >= 0.9, `independent p=${trueShare}: ${independent}`);
    assert.ok(correlated >= 0.9, `correlated p=${trueShare}: ${correlated}`);
  }
});

test("difference interval excludes zero for a large real shift and straddles zero for no shift", () => {
  const before = Array.from({ length: 60 }, (_, index) => index < 6);
  const after = Array.from({ length: 60 }, (_, index) => index < 40);
  const [low, high] = bootstrapDifference(before, after);
  assert.ok(low > 0 && high < 1);
  const [flatLow, flatHigh] = bootstrapDifference(before, before);
  assert.ok(flatLow < 0 && flatHigh > 0);
});

// Both arms are asked by the same personas, and persona taste drives most of the variation.
function correlatedArms(seed) {
  const random = seededRandom(seed);
  const control = [];
  const treatment = [];
  for (let persona = 0; persona < 24; persona++) {
    const propensity = random() < 0.4 ? 0.85 : 0.05;
    for (let model = 0; model < 3; model++) {
      control.push({ cluster: `p${persona}`, value: random() < propensity ? 1 : 0 });
      treatment.push({ cluster: `p${persona}`, value: random() < Math.min(1, propensity + 0.1) ? 1 : 0 });
    }
  }
  return { control, treatment };
}

test("paired persona bootstrap is narrower than the unpaired one when arms share personas", () => {
  const { control, treatment } = correlatedArms(5);
  const paired = pairedBootstrapDifference(control, treatment);
  const unpaired = unpairedBootstrapDifference(control, treatment);
  assert.deepEqual(paired, pairedBootstrapDifference(control, treatment));
  assert.ok(paired[1] - paired[0] < unpaired[1] - unpaired[0], `paired ${paired} vs unpaired ${unpaired}`);
});

test("paired lift interval sits above zero for a consistent per-persona gain and straddles zero for none", () => {
  const control = [];
  const treatment = [];
  for (let persona = 0; persona < 16; persona++) for (let model = 0; model < 2; model++) {
    control.push({ cluster: `p${persona}`, value: persona < 2 ? 1 : 0 });
    treatment.push({ cluster: `p${persona}`, value: persona < 10 ? 1 : 0 });
  }
  const [low] = pairedBootstrapDifference(control, treatment);
  assert.ok(low > 0);
  const [nullLow, nullHigh] = pairedBootstrapDifference(control, control);
  assert.ok(nullLow <= 0 && nullHigh >= 0);
  assert.deepEqual(pairedBootstrapDifference([], treatment), [0, 0]);
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
  const food = result.find((row) => row.name === "Food explorers").ci;
  assert.equal(food[0], 0);
  assert.ok(food[1] > 0.5, "one answer with no mention is not evidence of a 0% share");
});
