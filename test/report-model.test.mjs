import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildReportModel, reportText, summarizeAuditListing } from "../src/lib/report-model.mjs";

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
  assert.deepEqual(summarizeAuditListing(audit), { id: audit.id, brand: audit.brand, city: "Testville", createdAt: audit.createdAt, share: 0.2, answers: 30 });
  assert.throws(() => buildReportModel(null), /needs a stored audit/);
});
