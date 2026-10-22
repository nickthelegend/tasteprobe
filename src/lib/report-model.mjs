// A stored audit reduced to what a reader needs: the flight (share per segment with its 95%
// interval), the denominators and drops, the rival checks, every fix attempt with its placebo
// arm, the agent runs and the settings needed to reproduce the run. Pure: no I/O, no keys.
// Used by the printable report page (/audits/[id]/report) and the MCP get_report tool.

const round = (value, digits = 4) => (typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(digits)) : null);
const interval = (value) => (Array.isArray(value) && value.length === 2 ? [round(value[0]), round(value[1])] : null);

function segment(item) {
  const failed = item?.failed ?? { assistant: 0, unparseable: 0, extraction: 0 };
  return {
    id: String(item?.id ?? ""),
    name: String(item?.name ?? ""),
    personas: item?.personas ?? 0,
    mentions: item?.brandMentions ?? 0,
    answers: item?.responses ?? 0,
    attempted: item?.attempted ?? item?.responses ?? 0,
    dropped: { assistant: failed.assistant ?? 0, unparseable: failed.unparseable ?? 0, extraction: failed.extraction ?? 0 },
    share: item?.responses ? round(item.share) : null,
    ci: item?.responses ? interval(item.ci) : null,
    rivals: (item?.competitors ?? []).slice(0, 5).map((rival) => ({ name: rival.name, mentions: rival.mentions, share: round(rival.share) })),
  };
}

function arm(value) {
  return value ? { share: round(value.share), mentions: value.mentions, answers: value.responses, failed: value.failed, ci: interval(value.ci) } : null;
}

function lift(value) {
  return value ? { delta: round(value.delta), ci: interval(value.ci), clearsZero: Array.isArray(value.ci) && value.ci[0] > 0 } : null;
}

// Where a stored audit came from. runAudit stamps `live: true` on every audit it saves after a
// live run; the synthetic test fixtures carry `_fixture`; anything else was saved before the stamp
// existed and its provenance is not recorded. Only "live" may be described as a live run.
export function provenanceOf(audit) {
  if (audit?._fixture) return "synthetic";
  return audit?.live === true ? "live" : "unrecorded";
}

export const PROVENANCE_TEXT = { live: "Live run", synthetic: "Synthetic fixture, not a live run", unrecorded: "Provenance not recorded" };

// Hosts of the assistants under test that are public APIs. Any other MODEL_n_BASE_URL host may be a
// private endpoint, so public reads show it as "custom endpoint" (the model id stays).
export const PUBLIC_ASSISTANT_HOSTS = ["api.openai.com", "api.tokenfactory.nebius.com"];

// The stored audit as anyone with the URL may read it (GET /api/audits/<id>, the report page).
export function publicAudit(audit) {
  if (!audit?.meta?.assistants) return audit;
  return {
    ...audit,
    meta: { ...audit.meta, assistants: audit.meta.assistants.map((item) => (PUBLIC_ASSISTANT_HOSTS.includes(item.host) ? item : { ...item, host: "custom endpoint" })) },
  };
}

// Older audits have no personaSource; they were built from urn:tag before the fallback existed.
export const personaSourceOf = (audit) => (audit?.personaSource === "urn:entity" ? "urn:entity" : "urn:tag");

// "9 of 12 tags come from Qloo's global neighbourhood (the city had 3, fewer than 6)" when any did.
export function tagScopeText(scope) {
  if (!scope?.global) return "";
  const total = scope.city + scope.global;
  return `${scope.global} of ${total} ${scope.global === 1 ? "tag comes" : "tags come"} from Qloo's global neighbourhood (the city had ${scope.city}, fewer than 6)`;
}

export function personaSourceText(source) {
  return source === "urn:entity"
    ? "Qloo urn:entity affinities (artists, brands, films, books, TV, podcasts, places): this key refused urn:tag with a 403"
    : "Qloo urn:tag taste tags";
}

export function buildReportModel(audit) {
  if (!audit || typeof audit !== "object" || !audit.id) throw new Error("buildReportModel needs a stored audit.");
  const failedByKind = audit.failedByKind ?? { assistant: 0, unparseable: 0, extraction: 0 };
  return {
    id: audit.id,
    provenance: provenanceOf(audit),
    venue: { brand: audit.brand, category: audit.category, city: audit.city, address: audit.qlooAddress ?? null, qlooEntityId: audit.qlooEntityId },
    createdAt: audit.createdAt,
    durationSeconds: Math.round((audit.durationMs ?? 0) / 1000),
    personas: audit.personas?.length ?? 0,
    personaSource: personaSourceOf(audit),
    personaSourceNote: audit.personaSourceNote ?? null,
    tagScope: audit.tagScope ?? null,
    assistants: audit.systems ?? [],
    overall: segment(audit.overall),
    segments: (audit.segments ?? []).map(segment),
    byAssistant: (audit.modelSegments ?? []).map((entry) => ({ model: entry.model, segments: entry.segments.map(segment) })),
    answers: {
      usable: audit.responseCount ?? 0,
      dropped: audit.failedResponses ?? 0,
      attempted: (audit.responseCount ?? 0) + (audit.failedResponses ?? 0),
      droppedByKind: { assistant: failedByKind.assistant ?? 0, unparseable: failedByKind.unparseable ?? 0, extraction: failedByKind.extraction ?? 0 },
    },
    rivalChecks: (audit.rivalChecks ?? []).map((check) => ({ name: check.name, status: check.status, detail: check.detail ?? null })),
    extractionCheck: (audit.extractionCheck ?? []).map((check) => ({
      model: check.model, listed: check.listed, brandDisagreementRate: round(check.brandDisagreementRate), setDisagreementRate: round(check.setDisagreementRate),
    })),
    qlooSignals: audit.qlooSignals
      ? {
        domains: audit.qlooSignals.domains.map((domain) => ({ type: domain.type, entities: domain.entities.slice(0, 5), error: domain.error ?? null })),
        demographics: audit.qlooSignals.demographics,
        demographicsError: audit.qlooSignals.demographicsError ?? null,
      }
      : null,
    fixes: (audit.counterfactuals ?? []).map((attempt) => ({
      attempt: attempt.attempt,
      segment: attempt.segment,
      personas: attempt.personas,
      copy: attempt.change,
      rationale: attempt.rationale,
      placebo: attempt.placebo,
      model: attempt.model,
      createdAt: attempt.createdAt,
      arms: { baseline: arm(attempt.arms?.baseline), placebo: arm(attempt.arms?.placebo), fix: arm(attempt.arms?.fix) },
      lift: { fixVsPlacebo: lift(attempt.lift?.fixVsPlacebo), placeboVsBaseline: lift(attempt.lift?.placeboVsBaseline), fixVsBaseline: lift(attempt.lift?.fixVsBaseline) },
    })),
    agentRuns: (audit.agentRuns ?? []).map((run) => ({
      segment: run.segment,
      model: run.model,
      stopReason: run.stopReason,
      stopDetail: run.stopDetail,
      candidates: run.candidates?.length ?? 0,
      best: run.best ? { copy: run.best.copy, personas: run.best.personas, lift: round(run.best.lift), liftCi: interval(run.best.liftCi) } : null,
      search: run.search ?? null,
      confirmation: run.confirmation
        ? { mode: run.confirmation.mode, personas: run.confirmation.personas, lift: round(run.confirmation.lift), liftCi: interval(run.confirmation.liftCi), passed: run.confirmation.passed }
        : null,
      budget: run.budget,
      createdAt: run.createdAt,
    })),
    extraction: {
      model: audit.extractionModel,
      inputTokens: audit.extractionUsage?.inputTokens ?? 0,
      outputTokens: audit.extractionUsage?.outputTokens ?? 0,
      estimatedCostUsd: round(audit.estimatedExtractionCostUsd, 6),
    },
    reproducibility: audit.meta
      ? {
        assistants: audit.meta.assistants,
        assistantTemperature: audit.meta.assistantTemperature,
        personaSeed: audit.meta.personaSeed,
        liftBootstrapSeed: audit.meta.liftBootstrapSeed,
        nemotronMaxTokens: audit.meta.nemotronMaxTokens,
        nemotronThinking: audit.meta.nemotronThinking,
        extractionSystemPrompt: audit.meta.extractionSystemPrompt,
      }
      : null,
  };
}

// One line per audit for listings (GET /api/audits, MCP get_report without an id, the report
// page). No personas, Qloo ids, affinities or answers: only what a list row shows.
export function summarizeAuditListing(audit) {
  return {
    id: audit.id, brand: audit.brand, city: audit.city, category: audit.category, createdAt: audit.createdAt,
    share: round(audit.overall?.share), answers: audit.responseCount ?? 0, personas: audit.personas?.length ?? 0,
    personaSource: personaSourceOf(audit), origin: audit.origin ?? null, provenance: provenanceOf(audit),
  };
}

export const LISTING_PAGE = 12;
export const LISTING_MAX_PAGE = 50;

// The listing a visitor sees: the featured audit (TASTEPROBE_FEATURED_AUDIT_ID) pinned first
// whatever else has been run since, then the rest newest first, one page of summaries.
export function listAudits(audits, { featuredId = null, limit = LISTING_PAGE, offset = 0 } = {}) {
  const featured = featuredId ? audits.find((audit) => audit.id === featuredId) : undefined;
  const ordered = featured ? [featured, ...audits.filter((audit) => audit !== featured)] : audits;
  const size = Math.max(1, Math.min(LISTING_MAX_PAGE, Math.floor(Number(limit)) || LISTING_PAGE));
  const start = Math.max(0, Math.floor(Number(offset)) || 0);
  return {
    items: ordered.slice(start, start + size).map((audit) => ({ ...summarizeAuditListing(audit), featured: audit === featured })),
    total: audits.length,
    live: audits.filter((audit) => provenanceOf(audit) === "live").length,
    featuredId: featured ? featured.id : null,
  };
}

const pct = (value) => (value === null || value === undefined ? "n/a" : `${Math.round(value * 100)}%`);
const range = (ci) => (ci ? `${Math.round(ci[0] * 100)}–${Math.round(ci[1] * 100)}%` : "n/a");

// A short plain-text reading of the model, for agents and terminals.
export function reportText(model) {
  const lines = [
    `${model.venue.brand} (${model.venue.category}, ${model.venue.city}) · audit ${model.id} · ${model.createdAt}`,
    ...(model.provenance === "live" ? [] : [`${PROVENANCE_TEXT[model.provenance]}.`]),
    `Personas from ${personaSourceText(model.personaSource)}.`,
    `Whole flight: ${pct(model.overall.share)} of ${model.answers.usable} usable answers recommend it (95% ${range(model.overall.ci)}); ${model.answers.dropped} of ${model.answers.attempted} dropped (${model.answers.droppedByKind.assistant} call errors, ${model.answers.droppedByKind.unparseable} unparseable, ${model.answers.droppedByKind.extraction} extraction errors).`,
    ...model.segments.map((item) => `- ${item.name}: ${pct(item.share)} (${item.mentions}/${item.answers}, 95% ${range(item.ci)}, ${item.personas} personas)${item.rivals[0] ? `; poured most instead: ${item.rivals[0].name}` : ""}`),
  ];
  for (const fix of model.fixes) {
    const lift = fix.lift.fixVsPlacebo;
    lines.push(`Fix attempt ${fix.attempt} on ${fix.segment}: fix − placebo ${lift ? `${lift.delta >= 0 ? "+" : "−"}${Math.abs(Math.round(lift.delta * 100))} pts (95% ${range(lift.ci)})${lift.clearsZero ? ", clears zero" : ""}` : "n/a"}.`);
  }
  if (model.fixes.length > 1) lines.push(`Fix intervals are nominal per attempt; ${model.fixes.length} attempts were made on this audit.`);
  for (const run of model.agentRuns) lines.push(`Agent run on ${run.segment}: stopped (${run.stopReason}) ${run.stopDetail}${run.confirmation ? ` Confirmation on ${run.confirmation.personas} ${run.confirmation.mode === "holdout" ? "held-out" : "re-asked"} personas: ${run.confirmation.passed ? "confirmed" : "not confirmed"}.` : ""}`);
  lines.push(`Extraction: ${model.extraction.model} on Nebius Token Factory, ${model.extraction.inputTokens} in / ${model.extraction.outputTokens} out tokens.`);
  return lines.join("\n");
}
