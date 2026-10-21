import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readJsonFile, updateJsonFile, withFileLock } from "../src/lib/filestore.mjs";

async function scratch() {
  return mkdtemp(path.join(tmpdir(), "tasteprobe-store-"));
}

test("50 concurrent updates to one store all land, and no temp files are left behind", async () => {
  const dir = await scratch();
  try {
    const file = path.join(dir, "audits.json");
    await Promise.all(Array.from({ length: 50 }, (_, index) => updateJsonFile(file, [], async (audits) => {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 3));
      audits.push({ id: `a${index}` });
    })));
    const stored = JSON.parse(await readFile(file, "utf8"));
    assert.equal(stored.length, 50);
    assert.equal(new Set(stored.map((item) => item.id)).size, 50);
    assert.deepEqual(await readdir(dir), ["audits.json"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the unlocked read-modify-write pattern this replaces does lose updates", async () => {
  const dir = await scratch();
  try {
    const file = path.join(dir, "audits.json");
    await Promise.all(Array.from({ length: 20 }, async (_, index) => {
      const audits = await readJsonFile(file, []);
      await new Promise((resolve) => setTimeout(resolve, 2));
      audits.push({ id: `a${index}` });
      await writeFile(file, JSON.stringify(audits));
    }));
    const stored = JSON.parse(await readFile(file, "utf8"));
    assert.ok(stored.length < 20, `expected lost updates, got ${stored.length}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a failing update rejects without breaking the queue or the file", async () => {
  const dir = await scratch();
  try {
    const file = path.join(dir, "audits.json");
    await updateJsonFile(file, [], (audits) => { audits.push({ id: "kept" }); });
    const failing = updateJsonFile(file, [], () => { throw new Error("Audit not found."); });
    const after = updateJsonFile(file, [], (audits) => { audits.push({ id: "next" }); });
    await assert.rejects(failing, /Audit not found/);
    await after;
    assert.deepEqual((await readJsonFile(file, [])).map((item) => item.id), ["kept", "next"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the lock runs tasks for one file strictly one at a time", async () => {
  let active = 0;
  let peak = 0;
  await Promise.all(Array.from({ length: 10 }, () => withFileLock("/virtual/store.json", async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
  })));
  assert.equal(peak, 1);
});
