import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Audit } from "./types";

const dataDir = () => process.env.TASTEPROBE_DATA_DIR || path.join(process.cwd(), ".data");
const storePath = () => path.join(dataDir(), "audits.json");
const rawDir = (auditId: string) => path.join(dataDir(), "raw", auditId.replace(/[^a-zA-Z0-9-]/g, ""));

export async function readAudits(): Promise<Audit[]> {
  try { return JSON.parse(await readFile(storePath(), "utf8")) as Audit[]; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function findAudit(id: string) {
  return (await readAudits()).find((item) => item.id === id);
}

export async function saveAudit(audit: Audit) {
  const audits = await readAudits();
  const index = audits.findIndex((item) => item.id === audit.id);
  if (index >= 0) audits[index] = audit;
  else audits.unshift(audit);
  await mkdir(dataDir(), { recursive: true });
  await writeFile(storePath(), JSON.stringify(audits, null, 2), { mode: 0o600 });
}

export async function writeRaw(auditId: string, name: string, value: unknown) {
  await mkdir(rawDir(auditId), { recursive: true });
  await writeFile(path.join(rawDir(auditId), `${name}.json`), JSON.stringify(value, null, 2), { mode: 0o600 });
}

export async function readRaw<T>(auditId: string, name: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path.join(rawDir(auditId), `${name}.json`), "utf8")) as T; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
