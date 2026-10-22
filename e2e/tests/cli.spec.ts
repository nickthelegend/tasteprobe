import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
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

async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

test("a production server with no run token refuses paid runs with Setup required: TASTEPROBE_RUN_TOKEN", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-standalone", "production check runs once, with the standalone build");
  const data = await mkdtemp(path.join(tmpdir(), "tasteprobe-prod-"));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  // The same standalone build e2e/stack.sh assembled, started like the Dockerfile with no run token
  // and no TASTEPROBE_RUNS_OPEN. Killed by its own PID below.
  const server = spawn("node", [path.join(ROOT, "e2e/.run/standalone/server.js")], {
    cwd: ROOT, stdio: "ignore",
    env: { ...cleanEnv, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", HOSTNAME: "127.0.0.1", PORT: String(port), TASTEPROBE_DATA_DIR: data },
  });
  try {
    await expect.poll(async () => fetch(`${base}/api/status`).then((response) => response.status, () => 0), { timeout: 30_000 }).toBe(200);
    const status = await (await fetch(`${base}/api/status`)).json();
    expect(status.runs.setupRequired).toBe("TASTEPROBE_RUN_TOKEN");
    for (const route of ["/api/audits", "/api/audits/00000000-0000-4000-8000-000000000000/fix", "/api/audits/00000000-0000-4000-8000-000000000000/agent"]) {
      const response = await fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      expect(response.status, route).toBe(503);
      const body = await response.json();
      expect(body.code, route).toBe("setup_required");
      expect(body.error, route).toMatch(/^Setup required: TASTEPROBE_RUN_TOKEN/);
    }
    expect((await (await fetch(`${base}/api/status`)).json()).gate.runsToday).toBe(0);
    // The room names it with the missing keys and keeps Run audit disabled.
    await page.goto(`${base}/#room`);
    const setup = page.locator(".setup");
    await expect(setup.locator("li strong")).toHaveText([
      "Setup required: QLOO_API_KEY", "Setup required: NEBIUS_API_KEY",
      "Setup required: OPENAI_API_KEY or MODEL_2_API_KEY / MODEL_2_BASE_URL / MODEL_2_ID", "Setup required: TASTEPROBE_RUN_TOKEN",
    ]);
    await expect(page.getByRole("button", { name: "Run audit" })).toBeDisabled();
  } finally {
    server.kill();
    await rm(data, { recursive: true, force: true });
  }
});
