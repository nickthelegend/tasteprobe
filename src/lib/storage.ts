import { mkdir } from "node:fs/promises";
import path from "node:path";
import { readJsonFile, updateJsonFile, writeFileAtomic } from "./filestore.mjs";
import type { Audit } from "./types";

const dataDir = () => process.env.TASTEPROBE_DATA_DIR || path.join(process.cwd(), ".data");
const storePath = () => path.join(dataDir(), "audits.json");
export const rawDir = (auditId: string) => path.join(dataDir(), "raw", auditId.replace(/[^a-zA-Z0-9-]/g, ""));
export const reportsDir = () => path.join(dataDir(), "reports");

export async function readAudits(): Promise<Audit[]> {
  return readJsonFile<Audit[]>(storePath(), []);
}

export async function findAudit(id: string) {
  return (await readAudits()).find((item) => item.id === id);
}

// Insert or replace one audit. Serialised with every other store write and written atomically.
export async function saveAudit(audit: Audit) {
  await updateJsonFile<Audit[]>(storePath(), [], (audits) => {
    const index = audits.findIndex((item) => item.id === audit.id);
    if (index >= 0) audits[index] = audit;
    else audits.unshift(audit);
  });
}

// Applies `mutate` to the stored copy of the audit under the store lock, so long-running work
// (a fix re-test, an agent run) never writes back a stale snapshot over changes made meanwhile.
export async function updateAudit(id: string, mutate: (audit: Audit) => void) {
  let found: Audit | undefined;
  await updateJsonFile<Audit[]>(storePath(), [], (audits) => {
    found = audits.find((item) => item.id === id);
    if (!found) throw new Error("Audit not found.");
    mutate(found);
  });
  return found as Audit;
}

const safeName = (name: string) => name.replace(/[^a-zA-Z0-9-]/g, "");

export async function writeRaw(auditId: string, name: string, value: unknown) {
  await mkdir(rawDir(auditId), { recursive: true });
  await writeFileAtomic(path.join(rawDir(auditId), `${safeName(name)}.json`), JSON.stringify(value, null, 2));
}

export async function readRaw<T>(auditId: string, name: string): Promise<T | undefined> {
  return readJsonFile<T | undefined>(path.join(rawDir(auditId), `${safeName(name)}.json`), undefined);
}
