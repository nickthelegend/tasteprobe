// The printable report renderer, rendered to static HTML with react-dom/server.
// Uses test/fixtures/audit-synthetic.json: a hand-written SYNTHETIC audit, not a live run.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PrintReport, ReportEmpty } from "../src/lib/print-report.mjs";
import { buildReportModel } from "../src/lib/report-model.mjs";

const audit = JSON.parse(await readFile(new URL("./fixtures/audit-synthetic.json", import.meta.url), "utf8"));
const render = (element) => renderToStaticMarkup(element);

test("report renders the flight, the tasting sheet and every denominator", () => {
  const html = render(createElement(PrintReport, { model: buildReportModel(audit) }));
  assert.match(html, /<h1 id="rp-title">Fixture Venue \(synthetic\)<\/h1>/);
  assert.match(html, /audit 00000000-0000-4000-8000-000000000001/);
  // One glass per segment plus the whole-flight glass, each labelled with share and interval.
  assert.equal((html.match(/class="glass glass-dark rp-glass/g) ?? []).length, 2);
  assert.equal((html.match(/class="glass glass-light rp-glass/g) ?? []).length, 1);
  assert.match(html, /aria-label="Restaurant genre: 33%, 95% interval 15–58%"/);
  assert.match(html, /6 of 30 usable answers recommend it · 95% 9–38%/);
  assert.match(html, /32 attempted · 2 dropped \(1 call error, 1 unparseable\)/);
  assert.match(html, /<td data-label="Mentions \/ answers">5 \/ 15<\/td>/);
  assert.match(html, /<td data-label="Poured most instead">Rival One \(synthetic\) \(53%\)<\/td>/);
});

test("report shows the placebo arm, the lift and rival checks", () => {
  const html = render(createElement(PrintReport, { model: buildReportModel(audit) }));
  assert.match(html, /Fix − placebo: \+33 pts<\/b> \(95% 10 to 55 pts, clears zero\)/);
  assert.match(html, /Name exposure \(placebo − baseline\): \+13 pts, 95% -5 to 30 pts/);
  assert.match(html, /<th scope="row" data-label="Arm">placebo<\/th><td data-label="Share">20%<\/td>/);
  assert.match(html, /class="stamp stamp-ok">verified<\/span><b>Rival One \(synthetic\)<\/b>/);
  assert.match(html, /failed: Qloo \/v2\/insights returned 403 for filter.type=urn:entity:book/);
  assert.match(html, /nvidia\/NVIDIA-Nemotron-3-Nano-30B-A3B on Nebius Token Factory · 12,000 in \/ 3,400 out tokens · cost not estimated/);
});

test("stored copy is escaped, never injected as HTML", () => {
  const html = render(createElement(PrintReport, { model: buildReportModel(audit) }));
  assert.match(html, /Synthetic fix copy &lt;b&gt;with markup&lt;\/b&gt; that must be escaped\./);
  assert.doesNotMatch(html, /<b>with markup<\/b>/);
});

test("an audit with no fixes says so instead of leaving a blank section", () => {
  const html = render(createElement(PrintReport, { model: buildReportModel({ ...audit, counterfactuals: [], rivalChecks: [] }) }));
  assert.match(html, /No fix has been tested on this audit yet\./);
  assert.doesNotMatch(html, /Rivals checked in Qloo/);
});

test("empty state: no audits stored, or an unknown id with links to stored ones", () => {
  const none = render(createElement(ReportEmpty, {}));
  assert.match(none, /No audits stored yet/);
  assert.match(none, /only after a live audit with Qloo, Nebius and assistant keys completes\. Nothing is shown as an example\./);
  assert.doesNotMatch(none, /glass-wine/);

  const unknown = render(createElement(ReportEmpty, { requestedId: "missing-id", stored: [{ id: audit.id, brand: audit.brand, city: audit.city, createdAt: audit.createdAt }] }));
  assert.match(unknown, /No audit with this id/);
  assert.match(unknown, /This server has no stored audit missing-id\./);
  assert.match(unknown, /href="\/audits\/00000000-0000-4000-8000-000000000001\/report">Fixture Venue \(synthetic\), Testville<\/a>/);
});

test("the report says where the personas came from: urn:tag, or urn:entity after a 403", () => {
  const tagged = render(createElement(PrintReport, { model: buildReportModel(audit) }));
  assert.match(tagged, /<dt>Persona source<\/dt><dd>Qloo urn:tag taste tags\.<\/dd>/);
  assert.match(tagged, /2 taste segments · from urn:tag/);
  const fallback = buildReportModel({ ...audit, personaSource: "urn:entity", personaSourceNote: "Qloo /v2/insights returned 403 for filter.type=urn:tag" });
  assert.equal(fallback.personaSource, "urn:entity");
  const html = render(createElement(PrintReport, { model: fallback }));
  assert.match(html, /Qloo urn:entity affinities \(artists, brands, films, books, TV, podcasts, places\): this key refused urn:tag with a 403\. Qloo said: Qloo \/v2\/insights returned 403 for filter\.type=urn:tag/);
  assert.match(html, /from urn:entity/);
});

test("agent runs show the search as a screen and the confirmation as the result", () => {
  const run = {
    id: "r1", segment: "Place keyword", model: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", stopReason: "confirmation_failed",
    stopDetail: "A copy cleared the screen, but its confirmation probe's lift interval included zero, so no win is declared.",
    best: { id: "c2", copy: "Synthetic copy", rationale: "", personas: 8, placeboShare: 0.1, fixShare: 0.6, lift: 0.5, liftCi: [0.2, 0.8], failed: 0 },
    candidates: [{}, {}], budget: { tries: 2, turns: 6, assistantCalls: 64, nemotronCalls: 70, inputTokens: 1000, outputTokens: 500, usd: 0, priced: false },
    limits: { maxTries: 3, maxAssistantCalls: 120, maxUsd: null, maxNemotronTokens: 400000, maxTurns: 12 }, steps: 6,
    search: { personas: 8, looks: 3, candidates: 2 },
    confirmation: { candidateId: "c2", mode: "holdout", personas: 8, placeboShare: 0.2, fixShare: 0.3, lift: 0.1, liftCi: [-0.1, 0.3], failed: 0, passed: false },
    createdAt: "2026-10-22T12:00:00.000Z",
  };
  const html = render(createElement(PrintReport, { model: buildReportModel({ ...audit, agentRuns: [run] }) }));
  assert.match(html, /Search intervals are nominal and only screen/);
  assert.match(html, /3 looks · 2 copies · 8 personas/);
  assert.match(html, /\+50 pts \(20 to 80 pts\)/);
  assert.match(html, /\+10 pts \(-10 to 30 pts\) on 8 held-out personas · not confirmed/);
  assert.match(html, /confirmation_failed: A copy cleared the screen/);
});
