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

// Interval for (after − before) with each arm resampled independently.
export function bootstrapDifference(before, after, iterations = 2000, seed = 41) {
  if (before.length === 0 || after.length === 0) return [0, 0];
  const random = seededRandom(seed);
  const samples = [];
  for (let run = 0; run < iterations; run++) samples.push(mean(resample(after, random)) - mean(resample(before, random)));
  samples.sort((left, right) => left - right);
  return [quantile(samples, 0.025), quantile(samples, 0.975)];
}

export function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function summarizeObservations(observations) {
  const groups = new Map();
  for (const observation of observations) groups.set(observation.segment, [...(groups.get(observation.segment) ?? []), observation]);
  return [...groups.entries()].map(([name, rows]) => {
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
      personas: new Set(rows.map((row) => row.personaId).filter(Boolean)).size || rows.length,
      responses: rows.length,
      brandMentions: mentions,
      share: mentions / rows.length,
      ci: clusteredBootstrapInterval(rows.map((row) => ({ cluster: row.personaId, value: row.brand ? 1 : 0 }))),
      competitors: [...counts.values()].sort((a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name)).slice(0, 5)
        .map((competitor) => ({ ...competitor, share: competitor.mentions / rows.length })),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
