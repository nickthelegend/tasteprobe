// The form may only tick a box that has evidence. These checks keep README.md and
// HACKATHON_SUBMISSION_FORM.md honest.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const form = await readFile(new URL("../HACKATHON_SUBMISSION_FORM.md", import.meta.url), "utf8");

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
