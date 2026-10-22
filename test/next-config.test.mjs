// The public demo's framework: Next pinned to a release outside every npm advisory range known on
// 2026-10-23 (15.5.28), and the image optimizer switched off (the app uses no next/image).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import nextConfig from "../next.config.mjs";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const installed = JSON.parse(await readFile(new URL("../node_modules/next/package.json", import.meta.url), "utf8"));
const parts = (version) => version.split(".").map(Number);
const atLeast = (version, floor) => {
  const [a, b] = [parts(version), parts(floor)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

test("next is pinned exactly, at 15.5.28 or later, and the installed copy matches", () => {
  assert.match(pkg.dependencies.next, /^\d+\.\d+\.\d+$/, "pin an exact version");
  assert.ok(atLeast(pkg.dependencies.next, "15.5.28"), `next ${pkg.dependencies.next} is inside an advisory range`);
  assert.equal(installed.version, pkg.dependencies.next);
});

test("the image optimizer is off and the build is standalone", () => {
  assert.equal(nextConfig.images?.unoptimized, true);
  assert.equal(nextConfig.output, "standalone");
});
