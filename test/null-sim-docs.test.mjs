// The null-simulation figures quoted in the README and the form must be the ones
// scripts/null-sim.mjs prints (its committed output is docs/null-sim.txt). The two rules are named:
// "screen alone" (the old stop rule) and "confirmed" (screen, then one confirmation probe).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { nullRates } from "./null-trial.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const output = await read("docs/null-sim.txt");
const rows = [...output.matchAll(/^\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)%\s+([\d.]+)%$/gm)].map((m) => ({ size: +m[1], assistants: +m[2], copies: +m[3], screen: +m[4], confirmed: +m[5] }));
const range = (values) => `${Math.min(...values).toFixed(1)}-${Math.max(...values).toFixed(1)}%`;

test("docs/null-sim.txt holds the full 2000-run table: sizes 8/16/24, 1-2 assistants, 1-5 copies", () => {
  assert.match(output, /^Null simulation, 2000 seeded runs per row/);
  assert.equal(rows.length, 30);
  assert.ok(rows.every((row) => row.confirmed <= 5));
});

test("a row of the committed table reproduces from the code (seeded)", () => {
  const row = rows.find((item) => item.size === 8 && item.assistants === 2 && item.copies === 3);
  const rates = nullRates({ segmentSize: 8, assistants: 2, maxTries: 3, runs: 2000 });
  assert.equal((rates.screen * 100).toFixed(1), row.screen.toFixed(1));
  assert.equal((rates.confirmed * 100).toFixed(1), row.confirmed.toFixed(1));
});

test("the README and the form quote the table's ranges and nothing else", async () => {
  const readme = await read("README.md");
  const form = await read("HACKATHON_SUBMISSION_FORM.md");
  const at3 = range(rows.filter((row) => row.copies === 3).map((row) => row.screen));
  const at1 = range(rows.filter((row) => row.copies === 1).map((row) => row.screen));
  const screenAll = range(rows.map((row) => row.screen));
  const confirmedAll = range(rows.map((row) => row.confirmed));
  for (const text of [`screen alone wins ${at3} of runs at 3 copies and ${at1} with one copy`, `0.1-1.1% across segment sizes 8-24`, `against ${screenAll} for the screen alone`]) assert.ok(readme.includes(text.replace("0.1-1.1%", confirmedAll)), text);
  assert.ok(form.includes(`gave false wins in ${at3} of simulated null runs at 3 copies`));
  assert.ok(form.includes(`(${confirmedAll} false confirmed wins across 1-5 copies`));
  for (const stale of ["12-18%", "0.2-0.6%", "4.5-13.5%", "2000-run null simulation"]) {
    assert.ok(!readme.includes(stale) && !form.includes(stale), `stale figure ${stale}`);
  }
});
