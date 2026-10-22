#!/usr/bin/env node
// Reproduces the null-simulation figures quoted in the README and the submission form: the copy
// has NO effect (fix and placebo share each persona's rate), the agent policy and the stop rule
// are the repo's own (src/lib/agent-core.mjs, via test/null-trial.mjs), default limits apart from
// the copy count. Seeded, so the output is exact for this code. No network, no keys.
//   node scripts/null-sim.mjs [--runs 2000] [--json]
// "screen" = the old rule: stop as soon as a search interval clears zero.
// "confirmed" = the current rule: a screened copy must also pass one confirmation probe.
import { nullRates } from "../test/null-trial.mjs";

const args = process.argv.slice(2);
const runsAt = args.indexOf("--runs");
const runs = runsAt >= 0 ? Number(args[runsAt + 1]) : 2000;
if (!Number.isInteger(runs) || runs < 1) { console.error("--runs must be a positive integer"); process.exit(1); }

const rows = [];
for (const segmentSize of [8, 16, 24]) for (const assistants of [1, 2]) for (const maxTries of [1, 2, 3, 4, 5]) {
  rows.push({ segmentSize, assistants, maxTries, ...nullRates({ segmentSize, assistants, maxTries, runs }) });
}
if (args.includes("--json")) { console.log(JSON.stringify({ runs, rows }, null, 2)); process.exit(0); }

const pct = (value) => `${(value * 100).toFixed(1)}%`.padStart(6);
console.log(`Null simulation, ${runs} seeded runs per row (copy has no effect)`);
console.log("segment  assistants  copies  screen alone  confirmed");
for (const row of rows) console.log(`${String(row.segmentSize).padStart(7)}  ${String(row.assistants).padStart(10)}  ${String(row.maxTries).padStart(6)}  ${pct(row.screen).padStart(12)}  ${pct(row.confirmed).padStart(9)}`);
const range = (values) => `${pct(Math.min(...values)).trim()}-${pct(Math.max(...values)).trim()}`;
console.log(`screen alone: ${range(rows.map((row) => row.screen))} overall; at 3 copies ${range(rows.filter((row) => row.maxTries === 3).map((row) => row.screen))}; at 1 copy ${range(rows.filter((row) => row.maxTries === 1).map((row) => row.screen))}`);
console.log(`confirmed: ${range(rows.map((row) => row.confirmed))} overall (the test asserts at most 5%)`);
