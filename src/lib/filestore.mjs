// Safe JSON file updates for the local audit store.
// - In-process mutex per file: concurrent updates (an audit finishing while a fix attempt or an
//   agent run saves) are applied one after another, each on the latest contents.
// - Cross-process lock: updateJsonFile also holds <file>.lock, created with O_EXCL ("wx"), so the
//   web app, the MCP server and the CLI can share one data dir without losing each other's
//   writes. A lock whose process is gone, or that is older than LOCK_STALE_MS, is removed.
// - Atomic write: data goes to a temp file in the same directory, then rename() replaces the
//   target, so a reader never sees a half-written file (reads take no lock).
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const LOCK_STALE_MS = 30_000;
export const LOCK_TIMEOUT_MS = 60_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function processGone(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try { process.kill(pid, 0); return false; }
  catch (error) { return error?.code === "ESRCH"; }
}

// The lock's holder exited without removing it, or it is older than any store write could take.
async function lockIsStale(lock) {
  try {
    const holder = JSON.parse(await readFile(lock, "utf8"));
    return processGone(holder.pid) || Date.now() - Number(holder.at ?? 0) > LOCK_STALE_MS;
  } catch {
    // Just created and not written yet, or unreadable: judge by its age.
    try { return Date.now() - (await stat(lock)).mtimeMs > LOCK_STALE_MS; } catch { return false; }
  }
}

// Takes <file>.lock across processes; resolves with a release function.
export async function acquireFileLock(file, { timeoutMs = LOCK_TIMEOUT_MS } = {}) {
  const lock = `${file}.lock`;
  const started = Date.now();
  let delay = 4;
  for (;;) {
    try {
      const handle = await open(lock, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() })); }
      finally { await handle.close(); }
      let released = false;
      return async () => { if (!released) { released = true; await rm(lock, { force: true }); } };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await lockIsStale(lock)) { await rm(lock, { force: true }); continue; }
      if (Date.now() - started > timeoutMs) throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${lock}. Another TasteProbe process is writing this data dir; if none is running, delete the lock file.`);
      await sleep(delay + Math.random() * delay);
      delay = Math.min(100, delay * 2);
    }
  }
}

const queues = new Map();

export function withFileLock(file, task) {
  const key = path.resolve(file);
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.then(() => task());
  const settled = run.then(() => undefined, () => undefined);
  queues.set(key, settled);
  settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
  return run;
}

export async function writeFileAtomic(file, data, mode = 0o600) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temp, data, { mode });
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export async function readJsonFile(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) {
    if (error && error.code === "ENOENT") return fallback;
    throw error;
  }
}

// Reads the current JSON, lets `mutate` change it in place (or return a replacement), writes it
// atomically, and resolves with the final value. Runs under the file's in-process queue and its
// cross-process lock file.
export function updateJsonFile(file, fallback, mutate) {
  return withFileLock(file, async () => {
    await mkdir(path.dirname(file), { recursive: true });
    const release = await acquireFileLock(file);
    try {
      const current = await readJsonFile(file, structuredClone(fallback));
      const replaced = await mutate(current);
      const next = replaced === undefined ? current : replaced;
      await writeFileAtomic(file, JSON.stringify(next, null, 2));
      return next;
    } finally {
      await release();
    }
  });
}

// Runs `write` again whenever schedule() was called since the last run, never two at once, so the
// file on disk catches up with the latest state without one write per event. drain() waits for
// the last scheduled write to finish.
export function coalescingWriter(write) {
  let running = null;
  let dirty = false;
  const loop = async () => {
    while (dirty) {
      dirty = false;
      await write();
    }
  };
  return {
    schedule() {
      dirty = true;
      if (!running) running = loop().finally(() => { running = null; });
      return running;
    },
    async drain() {
      while (running) await running.catch(() => undefined);
    },
  };
}
