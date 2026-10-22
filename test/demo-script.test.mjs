// The Nebius demo video must run under 3 minutes. docs/demo.md's run of show gives each step a
// time in seconds; their sum must leave margin (at most 170 s) and match the total it states.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const doc = await readFile(new URL("../docs/demo.md", import.meta.url), "utf8");
const run = doc.slice(doc.indexOf("## Run of show"), doc.indexOf("## Cut lines"));
const steps = [...run.matchAll(/^\d+\. \*\*[^*(]+\((\d+)s[^)]*\)\.\*\*/gm)].map((match) => Number(match[1]));

test("the run of show adds up to 170 s or less, and the doc states that total", () => {
  assert.ok(steps.length >= 6, `found ${steps.length} timed steps`);
  const total = steps.reduce((sum, value) => sum + value, 0);
  assert.ok(total <= 170, `run of show is ${total} s`);
  assert.match(run, new RegExp(`^Total: ${steps.join(" \\+ ")} = ${total} s\\.$`, "m"));
  assert.match(doc.split("\n")[0], new RegExp(`\\(${total} seconds`));
});

test("the hook does not name an assistant that may not be configured", () => {
  assert.doesNotMatch(run.split("\n").find((line) => line.startsWith("1. ")) ?? "", /asks ChatGPT/);
});
