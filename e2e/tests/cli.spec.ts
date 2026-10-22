import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test, expect } from "./fixtures";

// The command-line side of the same no-keys journey, run once (desktop projects only) with an empty
// environment so no key can leak in. Nothing here calls a provider.
const run = promisify(execFile);
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const cleanEnv = { PATH: process.env.PATH!, HOME: process.env.HOME! };

async function exec(file: string, args: string[], env: Record<string, string> = cleanEnv) {
  try {
    const { stdout, stderr } = await run(file, args, { cwd: ROOT, env: env as NodeJS.ProcessEnv, timeout: 60_000, encoding: "utf8" });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
}

test("npm run audit:live preflight exits 1 and names every missing key before any API call", async ({}, info) => {
  test.skip(info.project.name !== "desktop", "CLI check runs once");
  const result = await exec("npm", ["run", "--silent", "audit:live", "--", "--brand", "The Bombay Canteen", "--city", "Mumbai", "--personas", "16"]);
  expect(result.code).toBe(1);
  expect(result.stderr.trim().split("\n")).toEqual([
    "Setup required: QLOO_API_KEY",
    "Setup required: NEBIUS_API_KEY",
    "Setup required: OPENAI_API_KEY (or MODEL_2_API_KEY, MODEL_2_BASE_URL and MODEL_2_ID)",
    "Add the keys to .env.local (see .env.example). No API was called.",
  ]);
  expect(result.stdout).not.toContain("Preflight ok");
  await info.attach("audit-live-preflight.txt", { body: `exit ${result.code}\n${result.stderr}` });
});

test("the standalone entrypoint refuses to start when the data dir is not writable", async ({}, info) => {
  test.skip(info.project.name !== "desktop-standalone", "entrypoint check runs once, with the standalone target");
  const locked = await mkdtemp(path.join(tmpdir(), "tasteprobe-ro-"));
  await run("chmod", ["500", locked]);
  try {
    const dataDir = path.join(locked, "data");
    const result = await exec(path.join(ROOT, "scripts/docker-entrypoint.sh"), ["node", "-e", "console.log('server would start')"], { ...cleanEnv, TASTEPROBE_DATA_DIR: dataDir });
    expect(result.code).toBe(1);
    expect(result.stdout).not.toContain("server would start");
    expect(result.stderr).toContain(`TasteProbe cannot start: TASTEPROBE_DATA_DIR=${dataDir} is not writable by uid`);
    await info.attach("entrypoint-refusal.txt", { body: `exit ${result.code}\n${result.stderr}` });
  } finally {
    await run("chmod", ["700", locked]);
    await rm(locked, { recursive: true, force: true });
  }
});
