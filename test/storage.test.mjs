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

test("the unlocked read-modify-write pattern this replaces loses updates or corrupts the file", async () => {
  const dir = await scratch();
  try {
    const file = path.join(dir, "audits.json");
    await Promise.all(Array.from({ length: 20 }, async (_, index) => {
      const audits = await readJsonFile(file, []);
      await new Promise((resolve) => setTimeout(resolve, 2));
      audits.push({ id: `a${index}` });
      await writeFile(file, JSON.stringify(audits));
    }));
    const text = await readFile(file, "utf8");
    let intact = false;
    try { intact = JSON.parse(text).length === 20; } catch { intact = false; } // interleaved writes can also leave invalid JSON
    assert.equal(intact, false, "expected lost updates or a torn file without the lock");
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

// Two separate Node processes, each making 60 updates to one store, like the web app and the MCP
// server sharing .data/. Before the cross-process lock about half the records were lost.
test("two processes writing the same store lose nothing: 2 x 60 updates give 120 records", { timeout: 60_000 }, async () => {
  const { spawn } = await import("node:child_process");
  const dir = await scratch();
  try {
    const file = path.join(dir, "audits.json");
    const store = new URL("../src/lib/filestore.mjs", import.meta.url).href;
    const worker = (tag) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", `
        const { updateJsonFile } = await import(${JSON.stringify(store)});
        for (let i = 0; i < 60; i++) await updateJsonFile(${JSON.stringify(file)}, [], (list) => { list.unshift({ id: ${JSON.stringify(tag)} + i }); });
      `], { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`worker ${tag} exited ${code}: ${stderr}`))));
    });
    await Promise.all([worker("a"), worker("b")]);
    const stored = JSON.parse(await readFile(file, "utf8"));
    assert.equal(stored.length, 120);
    assert.equal(new Set(stored.map((item) => item.id)).size, 120);
    assert.deepEqual(await readdir(dir), ["audits.json"], "no lock or temp file is left behind");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a lock left by a process that is gone is taken over; a live one makes the writer wait", async () => {
  const { acquireFileLock } = await import("../src/lib/filestore.mjs");
  const dir = await scratch();
  try {
    const file = path.join(dir, "audits.json");
    // pid 2^22 + 1 is above the default pid_max on Linux and macOS, so no process has it.
    await writeFile(`${file}.lock`, JSON.stringify({ pid: 4_194_305, at: Date.now() }));
    await updateJsonFile(file, [], (list) => { list.push({ id: "after-stale" }); });
    assert.deepEqual((await readJsonFile(file, [])).map((item) => item.id), ["after-stale"]);
    // A lock held by this live process (another task) blocks, then times out with a readable error.
    const release = await acquireFileLock(file);
    await assert.rejects(acquireFileLock(file, { timeoutMs: 150 }), /Timed out after 0s waiting for .*audits\.json\.lock\. Another TasteProbe process is writing this data dir/);
    await release();
    const again = await acquireFileLock(file, { timeoutMs: 150 });
    await again();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
