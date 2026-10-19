import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Audit } from "./types";

const storePath = path.join(process.cwd(), ".data", "audits.json");

export async function readAudits(): Promise<Audit[]> {
  try { return JSON.parse(await readFile(storePath, "utf8")) as Audit[]; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function saveAudit(audit: Audit) {
  const audits = await readAudits();
  const index = audits.findIndex((item) => item.id === audit.id);
  if (index >= 0) audits[index] = audit;
  else audits.unshift(audit);
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(audits, null, 2), { mode: 0o600 });
}
