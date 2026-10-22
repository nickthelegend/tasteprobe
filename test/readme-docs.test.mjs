// What a judge reads first must match what the code does on the hackathon key, and the form may only
// tick a box that has evidence. These checks keep README.md and HACKATHON_SUBMISSION_FORM.md honest.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const form = await readFile(new URL("../HACKATHON_SUBMISSION_FORM.md", import.meta.url), "utf8");

function section(doc, heading) {
  const start = doc.indexOf(`\n${heading}\n`);
  assert.ok(start >= 0, `missing section ${heading}`);
  const next = doc.indexOf("\n## ", start + heading.length + 2);
  return doc.slice(start, next < 0 ? undefined : next);
}

test("a short 'Try it in 2 minutes' block sits above the architecture", () => {
  const start = readme.indexOf("## Try it in 2 minutes");
  assert.ok(start >= 0, "README has no 'Try it in 2 minutes' section");
  assert.ok(start < readme.indexOf("## Architecture"), "the try-it block must come before the architecture");
  const block = section(readme, "## Try it in 2 minutes");
  const items = block.split("\n").filter((line) => /^\d+\. /.test(line));
  assert.ok(items.length >= 4 && items.length <= 5, `try-it block has ${items.length} numbered lines`);
  assert.match(block, /[Hh]osted demo/);
  assert.match(block, /featured/);
  assert.match(block, /\/audits\/<id>\/report/);
  assert.match(block, /`npm test`/);
});

test("the persona step describes the urn:entity path (the hackathon key) before urn:tag", () => {
  const numbers = section(readme, "## How the numbers are made");
  const step = numbers.split("\n").find((line) => line.startsWith("2. **Personas.**"));
  assert.ok(step, "no persona step");
  assert.ok(step.indexOf("urn:entity") >= 0 && step.indexOf("urn:entity") < step.indexOf("urn:tag"), "urn:tag is described first");
  assert.match(step, /hackathon key/);
});

test("the first Qloo /v2/insights bullet is the entity path", () => {
  const qloo = section(readme, "## Qloo");
  const bullet = qloo.split("\n").find((line) => line.startsWith("- ") && line.includes("/v2/insights"));
  assert.ok(bullet, "no /v2/insights bullet");
  assert.ok(bullet.includes("urn:entity") && (bullet.indexOf("urn:tag") < 0 || bullet.indexOf("urn:entity") < bullet.indexOf("urn:tag")), bullet);
});

test("the form does not tick Qloo integration while no live run has happened", () => {
  const notRun = /Status: not yet run end to end against live keys/.test(readme);
  const line = form.split("\n").find((entry) => entry.includes("Integrates the Qloo API"));
  assert.ok(line, "the Qloo integration line is missing");
  if (notRun) {
    assert.match(line, /^- \[ \]/, "ticked without a live run");
    assert.match(line, /PENDING KEYS/);
  }
  assert.doesNotMatch(form, /\[x\][^\n]*no live call yet/, "a ticked box admits it has no evidence");
});

test("the persona bullet in the form leads with the hackathon-key entity path", () => {
  const bullet = form.split("\n").find((line) => line.startsWith("- **Personas from Qloo.**"));
  assert.ok(bullet, "no persona bullet");
  assert.ok(bullet.indexOf("urn:entity") < 0 || bullet.indexOf("hackathon key") < bullet.indexOf("urn:tag"), bullet);
  assert.match(bullet, /hackathon key/);
});
