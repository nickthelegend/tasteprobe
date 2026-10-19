function quantile(sorted, probability) {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function bootstrapInterval(values, iterations = 1200, seed = 37) {
  if (values.length === 0) return [0, 0];
  let state = seed >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const samples = [];
  for (let run = 0; run < iterations; run++) {
    let total = 0;
    for (let index = 0; index < values.length; index++) total += Number(values[Math.floor(random() * values.length)]);
    samples.push(total / values.length);
  }
  samples.sort((left, right) => left - right);
  return [quantile(samples, 0.025), quantile(samples, 0.975)];
}

export function summarizeObservations(observations) {
  const groups = new Map();
  for (const observation of observations) groups.set(observation.segment, [...(groups.get(observation.segment) ?? []), observation]);
  return [...groups.entries()].map(([name, rows]) => {
    const mentions = rows.map((row) => row.brand);
    const counts = new Map();
    for (const row of rows) for (const item of new Set(row.recommended)) {
      const normalized = item.trim();
      if (normalized) counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
    return {
      id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name,
      personas: rows.length,
      profileCount: new Set(rows.map((row) => row.personaId).filter(Boolean)).size || rows.length,
      responses: rows.length,
      brandMentions: mentions.filter(Boolean).length,
      share: mentions.filter(Boolean).length / rows.length,
      ci: bootstrapInterval(mentions),
      competitors: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([competitor, count]) => ({ name: competitor, mentions: count, share: count / rows.length })),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
