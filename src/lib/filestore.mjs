// Safe JSON file updates for the local audit store.
// - In-process mutex per file: concurrent updates (an audit finishing while a fix attempt or an
//   agent run saves) are applied one after another, each on the latest contents.
// - Atomic write: data goes to a temp file in the same directory, then rename() replaces the
//   target, so a reader never sees a half-written file.
// Separate processes writing the same store are not serialised; run one server per data dir.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

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
// atomically, and resolves with the final value. Runs under the file's lock.
export function updateJsonFile(file, fallback, mutate) {
  return withFileLock(file, async () => {
    const current = await readJsonFile(file, structuredClone(fallback));
    const replaced = await mutate(current);
    const next = replaced === undefined ? current : replaced;
    await writeFileAtomic(file, JSON.stringify(next, null, 2));
    return next;
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
