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
