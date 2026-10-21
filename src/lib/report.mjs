// Builds and renders the run report written by scripts/live-audit.mjs. Pure: callers pass the
// audit, the cached raw responses and the hashes of the raw files.
import { matchesBrand } from "./taste.mjs";
import { summarizeObservations } from "./stats.mjs";

const rate = (part, whole) => (whole ? part / whole : 0);

// Recomputes the headline numbers from the cached raw responses, so a replay is derived from
// the recorded answers rather than copied from the stored summary.
export function recompute(audit, responses) {
  const rows = responses?.rows ?? [];
  const failures = responses?.failures ?? [];
  const observations = rows.map((row) => ({
    segment: row.segment, personaId: row.personaId, brand: Boolean(row.brand),
    recommended: (row.entities ?? []).filter((entity) => !matchesBrand(entity, audit.brand)),
  }));
  const overall = summarizeObservations(
    observations.map((row) => ({ ...row, segment: "All personas" })),
    failures.map((row) => ({ ...row, segment: "All personas", kind: row.kind ?? "extraction" })),
  )[0];
  const segments = summarizeObservations(observations, failures.map((row) => ({ ...row, kind: row.kind ?? "extraction" })));
  return { overall, segments };
}

export function buildReport({ audit, responses, rawFiles, mode, recordedAt, renderedAt, runtime }) {
  const { overall, segments } = recompute(audit, responses);
  const attempted = (responses?.rows?.length ?? 0) + (responses?.failures?.length ?? 0);
  const failures = responses?.failures ?? [];
  const byKind = (kind) => failures.filter((row) => (row.kind ?? "extraction") === kind).length;
  return {
    reportVersion: 1,
    mode,
    runId: audit.id,
    recordedAt,
    renderedAt,
    runtime,
    venue: { brand: audit.brand, category: audit.category, city: audit.city, qlooEntityId: audit.qlooEntityId, qlooAddress: audit.qlooAddress ?? null },
    models: {
      assistants: audit.meta?.assistants ?? audit.systems.map((name) => ({ name, model: name, host: "unknown" })),
      extraction: audit.extractionModel,
      assistantTemperature: audit.meta?.assistantTemperature ?? null,
      nemotronMaxTokens: audit.meta?.nemotronMaxTokens ?? null,
      nemotronThinking: audit.meta?.nemotronThinking ?? null,
    },
    seeds: { persona: audit.meta?.personaSeed ?? null, liftBootstrap: audit.meta?.liftBootstrapSeed ?? null },
    prompts: {
      extractionSystem: audit.meta?.extractionSystemPrompt ?? null,
      personas: [...new Map((responses?.rows ?? []).map((row) => [row.personaId, row.prompt])).entries()].map(([personaId, prompt]) => ({ personaId, prompt })),
    },
    failureRates: {
      attempted,
      answered: responses?.rows?.length ?? 0,
      failed: failures.length,
      rate: rate(failures.length, attempted),
      byKind: { assistant: byKind("assistant"), unparseable: byKind("unparseable"), extraction: byKind("extraction") },
    },
    results: {
      overall: overall ? { share: overall.share, ci: overall.ci, mentions: overall.brandMentions, responses: overall.responses } : null,
      segments: segments.map((segment) => ({ name: segment.name, personas: segment.personas, share: segment.share, ci: segment.ci, mentions: segment.brandMentions, responses: segment.responses, attempted: segment.attempted, failed: segment.failed, topRivals: segment.competitors.slice(0, 3).map((item) => item.name) })),
      storedOverallShare: audit.overall?.share ?? null,
      matchesStoredSummary: overall ? Math.abs(overall.share - (audit.overall?.share ?? NaN)) < 1e-12 : false,
    },
    extractionCheck: audit.extractionCheck ?? [],
    rawFiles,
  };
}

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const pct = (value) => `${Math.round((value ?? 0) * 100)}%`;
const ciText = (ci) => (ci ? `${pct(ci[0])}–${pct(ci[1])}` : "n/a");

export function renderReportHtml(report) {
  const banner = report.mode === "replay"
    ? `<div class="banner replay" role="status">Replay of run ${escape(report.runId)} recorded ${escape(report.recordedAt)}. Rendered ${escape(report.renderedAt)} from cached responses; no API was called.</div>`
    : `<div class="banner live" role="status">Live run ${escape(report.runId)} recorded ${escape(report.recordedAt)}.</div>`;
  const segmentRows = report.results.segments.map((segment) => `<tr><th>${escape(segment.name)}</th><td>${segment.personas}</td><td>${pct(segment.share)}</td><td>${ciText(segment.ci)}</td><td>${segment.mentions}/${segment.responses}</td><td>${segment.attempted - segment.responses}</td><td>${escape(segment.topRivals.join(", "))}</td></tr>`).join("");
  const fileRows = report.rawFiles.map((file) => `<tr><td><code>${escape(file.name)}</code></td><td>${file.bytes.toLocaleString("en-US")}</td><td><code>${escape(file.sha256)}</code>${file.matchesRecorded === false ? ' <b class="bad">changed since recording</b>' : ""}</td></tr>`).join("");
  const promptRows = report.prompts.personas.map((item) => `<li><b>${escape(item.personaId)}</b> ${escape(item.prompt)}</li>`).join("");
  const assistants = report.models.assistants.map((item) => `${escape(item.name)} (<code>${escape(item.model)}</code> @ ${escape(item.host)})`).join(", ");
  const check = report.extractionCheck.map((item) => `<li>${escape(item.model)}: ${item.brandDisagreementRate === null ? "no numbered lists" : `${pct(item.brandDisagreementRate)} brand disagreement, ${pct(item.setDisagreementRate)} list disagreement (n=${item.listed})`}</li>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>TasteProbe run ${escape(report.runId)}</title>
<style>
:root { --berry: #2a0f2e; --pink: #ff6ec7; --ink: #fff4fa; --muted: #bc9db8; --surface: #36163c; }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 16px 48px; background: var(--berry); color: var(--ink); font: 15px/1.5 Outfit, system-ui, sans-serif; }
main { max-width: 1040px; margin: 0 auto; display: grid; gap: 20px; }
h1 { font-weight: 500; letter-spacing: -.03em; margin: 0; font-size: clamp(26px, 5vw, 40px); }
h2 { font-weight: 500; font-size: 18px; margin: 0 0 10px; }
section { background: var(--surface); border-radius: 20px; padding: 18px; overflow-x: auto; }
.banner { border-radius: 16px; padding: 14px 16px; font-weight: 500; overflow-wrap: anywhere; }
.banner.replay { background: #ffd27a; color: #2a0018; }
.banner.live { background: rgba(127, 227, 174, .16); color: #7fe3ae; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid rgba(255, 230, 245, .12); vertical-align: top; }
code { font-size: 12.5px; overflow-wrap: anywhere; }
.muted { color: var(--muted); }
.bad { color: #ff8f8f; }
ul { margin: 0; padding-left: 18px; }
li { margin: 4px 0; overflow-wrap: anywhere; }
</style></head>
<body><main>
${banner}
<h1>${escape(report.venue.brand)} <span class="muted">· ${escape(report.venue.category)} · ${escape(report.venue.city)}</span></h1>
<section><h2>Share of voice</h2>
<p>Overall ${pct(report.results.overall?.share)} (95% CI ${ciText(report.results.overall?.ci)}), ${report.results.overall?.mentions ?? 0} of ${report.results.overall?.responses ?? 0} answers. Recomputed from cached responses: ${report.results.matchesStoredSummary ? "matches the stored summary" : '<b class="bad">differs from the stored summary</b>'}.</p>
<table><thead><tr><th>Segment</th><th>Personas</th><th>Share</th><th>95% CI</th><th>Mentions</th><th>Dropped</th><th>Top rivals</th></tr></thead><tbody>${segmentRows}</tbody></table></section>
<section><h2>Failures</h2><p>${report.failureRates.failed} of ${report.failureRates.attempted} calls produced no usable answer (${pct(report.failureRates.rate)}): ${report.failureRates.byKind.assistant} assistant errors, ${report.failureRates.byKind.unparseable} unparseable extractions, ${report.failureRates.byKind.extraction} extraction errors. They are excluded from every denominator above.</p></section>
<section><h2>Models and seeds</h2><ul>
<li>Assistants: ${assistants || "none recorded"}; temperature ${escape(report.models.assistantTemperature ?? "n/a")}</li>
<li>Extraction: <code>${escape(report.models.extraction)}</code> on Nebius; max_tokens ${escape(report.models.nemotronMaxTokens ?? "n/a")}; thinking ${escape(report.models.nemotronThinking ?? "n/a")}</li>
<li>Persona seed ${escape(report.seeds.persona ?? "n/a")}; lift bootstrap seed ${escape(report.seeds.liftBootstrap ?? "n/a")}</li>
<li>Runtime: ${escape(report.runtime)}</li>
</ul>${check ? `<h2 style="margin-top:14px">Extraction cross-check</h2><ul>${check}</ul>` : ""}</section>
<section><h2>Raw files (SHA-256)</h2><table><thead><tr><th>File</th><th>Bytes</th><th>SHA-256</th></tr></thead><tbody>${fileRows}</tbody></table></section>
<section><h2>Prompts</h2><p class="muted">Extraction system prompt: ${escape(report.prompts.extractionSystem ?? "not recorded")}</p><ul>${promptRows}</ul></section>
</main></body></html>
`;
}
