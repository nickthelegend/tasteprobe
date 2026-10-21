function quantile(sorted, probability) {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

// Deterministic LCG so the same cached responses always produce the same intervals.
export function seededRandom(seed = 37) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function mean(values) {
  let total = 0;
  for (const value of values) total += Number(value);
  return values.length ? total / values.length : 0;
}

function resample(values, random) {
  const sample = new Array(values.length);
  for (let index = 0; index < values.length; index++) sample[index] = values[Math.floor(random() * values.length)];
  return sample;
}

export function bootstrapInterval(values, iterations = 2000, seed = 37) {
  if (values.length === 0) return [0, 0];
  const random = seededRandom(seed);
  const samples = [];
  for (let run = 0; run < iterations; run++) samples.push(mean(resample(values, random)));
  samples.sort((left, right) => left - right);
  return [quantile(samples, 0.025), quantile(samples, 0.975)];
}

// Responses from one persona (asked of several assistants) are correlated, so resample personas, not rows.
export function clusteredBootstrapInterval(rows, iterations = 2000, seed = 37) {
  if (rows.length === 0) return [0, 0];
  const clusters = new Map();
  rows.forEach((row, index) => {
    const key = row.cluster ?? `row-${index}`;
    clusters.set(key, [...(clusters.get(key) ?? []), Number(row.value)]);
  });
  const groups = [...clusters.values()];
  const random = seededRandom(seed);
  const samples = [];
  for (let run = 0; run < iterations; run++) {
    let hits = 0;
    let count = 0;
    for (const group of resample(groups, random)) {
      for (const value of group) hits += value;
      count += group.length;
    }
    samples.push(count ? hits / count : 0);
  }
  samples.sort((left, right) => left - right);
  return [quantile(samples, 0.025), quantile(samples, 0.975)];
}

// Interval for (after − before) with each arm's rows resampled independently. Ignores persona
// clustering and pairing; kept as the naive reference the paired interval is compared against.
export function bootstrapDifference(before, after, iterations = 2000, seed = 41) {
  if (before.length === 0 || after.length === 0) return [0, 0];
  const random = seededRandom(seed);
  const samples = [];
  for (let run = 0; run < iterations; run++) samples.push(mean(resample(after, random)) - mean(resample(before, random)));
  samples.sort((left, right) => left - right);
  return [quantile(samples, 0.025), quantile(samples, 0.975)];
}

export const Z_95 = 1.959964;

// Wilson score interval for a binomial share. `n` may be fractional (an effective sample size).
export function wilsonInterval(successes, n, z = Z_95) {
  if (!(n > 0)) return [0, 1];
  const share = Math.min(1, Math.max(0, successes / n));
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const centre = (share + z2 / (2 * n)) / denominator;
  const half = (z * Math.sqrt((share * (1 - share)) / n + z2 / (4 * n * n))) / denominator;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

// Persona id → {hits, count}. Rows without a persona id are their own cluster.
function clusterIndex(rows) {
  const map = new Map();
  rows.forEach((row, index) => {
    const key = row.cluster ?? `row-${index}`;
    const current = map.get(key) ?? { hits: 0, count: 0 };
    current.hits += Number(row.value);
    current.count += 1;
    map.set(key, current);
  });
  return map;
}

// Kish design effect for a share estimated from clustered rows (one persona answered by several
// assistants): ratio of the cluster-robust variance to the binomial variance, kept in [1, N/k] so
// the effective sample size lies between the number of personas and the number of answers.
// With no variation (all 0 or all 1) the within-persona correlation cannot be estimated, so the
// conservative choice is made: count personas, not answers.
export function designEffect(rows) {
  const clusters = [...clusterIndex(rows).values()];
  const k = clusters.length;
  const total = clusters.reduce((sum, cluster) => sum + cluster.count, 0);
  if (total === 0) return { deff: 1, clusters: 0, responses: 0, effectiveN: 0 };
  const share = clusters.reduce((sum, cluster) => sum + cluster.hits, 0) / total;
  const ceiling = total / k;
  let deff;
  if (k <= 1) deff = total;
  else if (share === 0 || share === 1) deff = ceiling;
  else {
    let squares = 0;
    for (const cluster of clusters) squares += (cluster.hits - share * cluster.count) ** 2;
    const robust = (k / (k - 1)) * squares / (total * total);
    const binomial = (share * (1 - share)) / total;
    deff = Math.min(Math.max(robust / binomial, 1), ceiling);
  }
  return { deff, clusters: k, responses: total, effectiveN: total / deff };
}

// 95% interval for a share of voice: Wilson on the design-effect-adjusted effective sample size.
// 0 mentions in 12 answers gives an upper bound near 24%, never a collapsed [0, 0].
export function shareInterval(rows, z = Z_95) {
  if (rows.length === 0) return [0, 1];
  const { effectiveN } = designEffect(rows);
  const share = rows.reduce((sum, row) => sum + Number(row.value), 0) / rows.length;
  return wilsonInterval(share * effectiveN, effectiveN, z);
}

function percentileInterval(samples) {
  if (!samples.length) return [0, 0];
  samples.sort((left, right) => left - right);
  return [quantile(samples, 0.025), quantile(samples, 0.975)];
}

// Lift (treatment − control) where both arms asked the SAME personas. Personas are resampled once
// per iteration and both arms use that same draw, so persona-level taste cancels out of the lift.
export const LIFT_BOOTSTRAP_SEED = 41;

export function pairedBootstrapDifference(control, treatment, iterations = 2000, seed = LIFT_BOOTSTRAP_SEED) {
  const left = clusterIndex(control);
  const right = clusterIndex(treatment);
  const personas = [...new Set([...left.keys(), ...right.keys()])];
  if (!left.size || !right.size) return [0, 0];
  const random = seededRandom(seed);
  const samples = [];
  for (let run = 0; run < iterations; run++) {
    let controlHits = 0, controlCount = 0, treatmentHits = 0, treatmentCount = 0;
    for (let draw = 0; draw < personas.length; draw++) {
      const persona = personas[Math.floor(random() * personas.length)];
      const a = left.get(persona);
      const b = right.get(persona);
      if (a) { controlHits += a.hits; controlCount += a.count; }
      if (b) { treatmentHits += b.hits; treatmentCount += b.count; }
    }
    if (controlCount && treatmentCount) samples.push(treatmentHits / treatmentCount - controlHits / controlCount);
  }
  return percentileInterval(samples);
}

// Same lift, but each arm's personas resampled independently (what you would do if the arms
// had been asked by different personas). Used to show what pairing buys.
export function unpairedBootstrapDifference(control, treatment, iterations = 2000, seed = 41) {
  const left = [...clusterIndex(control).values()];
  const right = [...clusterIndex(treatment).values()];
  if (!left.length || !right.length) return [0, 0];
  const random = seededRandom(seed);
  const share = (groups) => {
    let hits = 0, count = 0;
    for (let draw = 0; draw < groups.length; draw++) {
      const group = groups[Math.floor(random() * groups.length)];
      hits += group.hits; count += group.count;
    }
    return count ? hits / count : 0;
  };
  const samples = [];
  for (let run = 0; run < iterations; run++) samples.push(share(right) - share(left));
  return percentileInterval(samples);
}

export function shareOf(rows) {
  return rows.length ? rows.reduce((sum, row) => sum + Number(row.value), 0) / rows.length : 0;
}

export function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function failureCounts(failures) {
  const counts = { assistant: 0, unparseable: 0, extraction: 0 };
  for (const failure of failures) counts[failure.kind in counts ? failure.kind : "extraction"] += 1;
  return counts;
}

// `failures` are calls that produced no usable answer (assistant error, unparseable or failed
// extraction). They are not in the share's denominator, but every segment reports them.
export function summarizeObservations(observations, failures = []) {
  const groups = new Map();
  for (const observation of observations) groups.set(observation.segment, [...(groups.get(observation.segment) ?? []), observation]);
  for (const failure of failures) if (!groups.has(failure.segment)) groups.set(failure.segment, []);
  return [...groups.entries()].map(([name, rows]) => {
    const failed = failureCounts(failures.filter((failure) => failure.segment === name));
    const dropped = failed.assistant + failed.unparseable + failed.extraction;
    const mentions = rows.filter((row) => row.brand).length;
    const counts = new Map();
    for (const row of rows) {
      const seen = new Set();
      for (const item of row.recommended) {
        const display = item.trim();
        const key = display.toLowerCase();
        if (!display || seen.has(key)) continue;
        seen.add(key);
        const current = counts.get(key);
        counts.set(key, { name: current?.name ?? display, mentions: (current?.mentions ?? 0) + 1 });
      }
    }
    return {
      id: slug(name),
      name,
      personas: new Set([...rows, ...failures.filter((failure) => failure.segment === name)].map((row) => row.personaId).filter(Boolean)).size || rows.length,
      responses: rows.length,
      attempted: rows.length + dropped,
      failed,
      brandMentions: mentions,
      share: rows.length ? mentions / rows.length : 0,
      ci: shareInterval(rows.map((row) => ({ cluster: row.personaId, value: row.brand ? 1 : 0 }))),
      competitors: [...counts.values()].sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name)).slice(0, 5)
        .map((competitor) => ({ ...competitor, share: rows.length ? competitor.mentions / rows.length : 0 })),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

const asCluster = (rows) => rows.map((row) => ({ cluster: row.personaId, value: row.brand ? 1 : 0 }));

function armSummary(rows, failed) {
  const clustered = asCluster(rows);
  const mentions = rows.filter((row) => row.brand).length;
  return { share: shareOf(clustered), mentions, responses: rows.length, failed, ci: shareInterval(clustered) };
}

function lift(control, treatment) {
  return { delta: shareOf(asCluster(treatment)) - shareOf(asCluster(control)), ci: pairedBootstrapDifference(asCluster(control), asCluster(treatment)) };
}

// Three arms asked by the same personas in the same run: baseline (no snippet), placebo (neutral
// snippet naming the brand) and fix (the proposed copy). The headline lift is fix − placebo.
export function compareArms({ baseline, placebo, fix }) {
  return {
    arms: {
      baseline: armSummary(baseline.rows, baseline.failed),
      placebo: armSummary(placebo.rows, placebo.failed),
      fix: armSummary(fix.rows, fix.failed),
    },
    lift: {
      fixVsPlacebo: lift(placebo.rows, fix.rows),
      fixVsBaseline: lift(baseline.rows, fix.rows),
      placeboVsBaseline: lift(baseline.rows, placebo.rows),
    },
  };
}
