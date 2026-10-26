import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildReportModel, listAudits, reportText, summarizeAuditListing } from "../src/lib/report-model.mjs";

// SYNTHETIC fixture: hand-written, not a live run (see its _fixture field).
const audit = JSON.parse(await readFile(new URL("./fixtures/audit-synthetic.json", import.meta.url), "utf8"));

test("report model keeps shares, intervals and every denominator", () => {
  const model = buildReportModel(audit);
  assert.equal(model.venue.brand, "Fixture Venue (synthetic)");
  assert.deepEqual(model.overall.ci, [0.09, 0.38]);
  assert.deepEqual(model.answers, { usable: 30, dropped: 2, attempted: 32, droppedByKind: { assistant: 1, unparseable: 1, extraction: 0 } });
  assert.deepEqual(model.segments.map((item) => [item.name, item.share, item.answers, item.attempted]), [["Restaurant genre", 0.3333, 15, 16], ["Place keyword", 0.0667, 15, 16]]);
  assert.equal(model.fixes[0].lift.fixVsPlacebo.clearsZero, true);
  assert.equal(model.fixes[0].lift.placeboVsBaseline.clearsZero, false);
  assert.equal(model.extraction.estimatedCostUsd, null);
  assert.equal(model.reproducibility.personaSeed, 7);
});

test("a segment with no usable answers has no share or interval rather than 0%", () => {
  const empty = { ...audit, segments: [{ ...audit.segments[0], responses: 0, brandMentions: 0, share: 0, ci: [0, 0] }] };
  const [segment] = buildReportModel(empty).segments;
  assert.equal(segment.share, null);
  assert.equal(segment.ci, null);
});

test("report text and listing", () => {
  const text = reportText(buildReportModel(audit));
  assert.match(text, /Restaurant genre: 33% \(5\/15, 95% 15–58%, 8 personas\); poured most instead: Rival One \(synthetic\)/);
  assert.deepEqual(summarizeAuditListing(audit), {
    id: audit.id, brand: audit.brand, city: "Testville", category: "restaurant", createdAt: audit.createdAt, share: 0.2, answers: 30,
    personas: audit.personas.length, personaSource: "urn:tag", origin: null, provenance: "synthetic",
  });
  assert.throws(() => buildReportModel(null), /needs a stored audit/);
});

test("the listing pins the featured audit first even after 13 newer runs, and carries summaries only", () => {
  // 13 newer copies under new ids, newest first, as the store keeps them; the original is the oldest.
  const newer = Array.from({ length: 13 }, (_, index) => ({ ...audit, id: `00000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`, createdAt: `2026-10-22T12:${String(59 - index).padStart(2, "0")}:00.000Z`, origin: "web" }));
  const store = [...newer, audit];
  const plain = listAudits(store);
  assert.equal(plain.items.length, 12);
  assert.ok(!plain.items.some((item) => item.id === audit.id), "without a featured id the oldest audit drops off the first page");
  const featured = listAudits(store, { featuredId: audit.id });
  assert.equal(featured.total, 14);
  assert.equal(featured.featuredId, audit.id);
  assert.equal(featured.items[0].id, audit.id);
  assert.equal(featured.items[0].featured, true);
  assert.equal(featured.items.filter((item) => item.featured).length, 1);
  assert.equal(featured.items.length, 12);
  assert.equal(featured.items[1].id, newer[0].id);
  for (const item of featured.items) {
    for (const field of ["personas", "segments", "overall", "qlooSignals", "counterfactuals", "agentRuns", "qlooEntityId"]) {
      assert.ok(field === "personas" ? typeof item.personas === "number" : !(field in item), `${field} stays out of the listing`);
    }
  }
  assert.ok(JSON.stringify(featured.items).length < JSON.stringify(store.slice(0, 12)).length / 5, "summaries are a fraction of the full audits");
  // Paging and bounds; an unknown featured id is ignored.
  assert.deepEqual(listAudits(store, { featuredId: audit.id, offset: 12, limit: 12 }).items.map((item) => item.id), [newer[11].id, newer[12].id]);
  assert.equal(listAudits(store, { limit: 500 }).items.length, 14);
  assert.equal(listAudits(store, { limit: 0 }).items.length, 1);
  assert.equal(listAudits(store, { limit: -1 }).items.length, 1);
  assert.equal(listAudits(store, { limit: "not-a-number" }).items.length, 12);
  assert.equal(listAudits(store).items.length, 12);
  assert.equal(listAudits(Array(60).fill(audit), { limit: 51 }).items.length, 50);
  assert.equal(listAudits(store, { featuredId: "missing" }).featuredId, null);
});

test("provenance: the synthetic fixture is never counted or described as a live run", () => {
  const { _fixture, ...unmarked } = audit;
  assert.ok(_fixture);
  const live = { ...unmarked, id: "live-1", live: true };
  const old = { ...unmarked, id: "old-1" };
  assert.equal(summarizeAuditListing(audit).provenance, "synthetic");
  assert.equal(summarizeAuditListing(live).provenance, "live");
  assert.equal(summarizeAuditListing(old).provenance, "unrecorded");
  // A fixture that also says live: true is still synthetic.
  assert.equal(summarizeAuditListing({ ...audit, live: true }).provenance, "synthetic");
  assert.equal(listAudits([audit, audit, old]).live, 0);
  assert.equal(listAudits([live, audit, old]).live, 1);
  assert.equal(buildReportModel(audit).provenance, "synthetic");
  assert.match(reportText(buildReportModel(audit)), /^Synthetic fixture, not a live run\.$/m);
  assert.doesNotMatch(reportText(buildReportModel(live)), /Synthetic fixture|Provenance not recorded/);
});

test("public reads show a private assistant host as 'custom endpoint', keep public API hosts and model ids", async () => {
  const { publicAudit } = await import("../src/lib/report-model.mjs");
  const stored = { ...audit, meta: { ...audit.meta, assistants: [
    { name: "gpt", model: "gpt-4o-mini", host: "api.openai.com" },
    { name: "llama", model: "meta-llama/Llama-3.3-70B-Instruct", host: "api.tokenfactory.nebius.com" },
    { name: "private", model: "in-house-1", host: "llm.internal.example.com" },
  ] } };
  const shown = publicAudit(stored);
  assert.deepEqual(shown.meta.assistants.map((item) => item.host), ["api.openai.com", "api.tokenfactory.nebius.com", "custom endpoint"]);
  assert.equal(shown.meta.assistants[2].model, "in-house-1");
  assert.doesNotMatch(JSON.stringify(shown), /llm\.internal\.example\.com/);
  assert.equal(stored.meta.assistants[2].host, "llm.internal.example.com", "the stored audit is not changed");
  assert.equal(publicAudit(audit).meta.assistants[0].host, "custom endpoint");
});
