#!/usr/bin/env node
// Seeds the "public demo" E2E target's data dir (e2e/.run/data-public, git-ignored, deleted by
// `e2e/stack.sh stop`) with the SYNTHETIC fixture test/fixtures/audit-synthetic.json as the
// featured audit plus 13 newer copies under new ids and names, so the listing, the featured pin
// and the results views can be checked in a browser without keys. Nothing here is a live run, and
// every venue name says "(synthetic)".
//   node e2e/seed.mjs <data dir>
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const dir = process.argv[2];
if (!dir) { console.error("usage: node e2e/seed.mjs <data dir>"); process.exit(1); }
const fixture = JSON.parse(await readFile(new URL("../test/fixtures/audit-synthetic.json", import.meta.url), "utf8"));
export const FEATURED_ID = fixture.id;
const copies = Array.from({ length: 13 }, (_, index) => ({
  ...structuredClone(fixture),
  id: `00000000-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`,
  brand: `Visitor Venue ${index + 1} (synthetic)`,
  createdAt: new Date(Date.parse(fixture.createdAt) + (13 - index) * 3_600_000).toISOString(),
  origin: "web",
}));
await mkdir(dir, { recursive: true, mode: 0o700 });
// Newest first, as the store keeps them; the featured fixture is the oldest.
await writeFile(path.join(dir, "audits.json"), JSON.stringify([...copies, fixture], null, 2), { mode: 0o600 });
console.log(`seeded ${copies.length + 1} synthetic audits into ${dir}`);
