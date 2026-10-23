import { test, expect, expectNoHorizontalScroll, logControls, shot } from "./fixtures";
import type { Page } from "@playwright/test";

const SETUP = [
  ["QLOO_API_KEY", "Qloo key not configured, so personas cannot be built from real taste data."],
  ["NEBIUS_API_KEY", "Nebius key not configured, so NVIDIA Nemotron extraction cannot run."],
  ["OPENAI_API_KEY or MODEL_2_API_KEY / MODEL_2_BASE_URL / MODEL_2_ID", "there is no assistant to test."],
];

async function openRoom(page: Page) {
  const status = page.waitForResponse((response) => response.url().endsWith("/api/status"));
  const audits = page.waitForResponse((response) => response.url().endsWith("/api/audits") && response.request().method() === "GET");
  await page.goto("/#room");
  expect((await status).status()).toBe(200);
  expect(await (await audits).json()).toEqual([]);
  await expect(page.locator(".setup")).toBeVisible();
  return page.locator("#room");
}

test.describe("tasting room with no keys", () => {
  test("Setup required names every missing key; the cellar shows each connection missing", async ({ page }) => {
    const room = await openRoom(page);
    const setup = room.getByRole("alert").filter({ has: page.getByRole("heading", { name: "Setup required" }) });
    // Names where the keys go both on a hosted server and on a local checkout.
    await expect(setup).toContainText("The flight stays corked until these are set in the server’s environment (.env.local when you run it yourself).");
    const items = setup.locator("li");
    await expect(items).toHaveCount(3);
    for (const [index, [name, detail]] of SETUP.entries()) {
      await expect(items.nth(index).locator("strong")).toHaveText(`Setup required: ${name}`);
      await expect(items.nth(index).locator("span")).toHaveText(detail);
    }
    const cellar = room.getByLabel("Connections");
    // A missing Nebius key reads "key missing", like Qloo, not the model name next to a red dot.
    await expect(cellar.locator(".cellar-item")).toHaveText(["Qlookey missing", "Nebiuskey missing", "Assistantsnone configured"]);
    await expect(cellar.locator(".dot.bad")).toHaveCount(3);
    await expect(cellar.locator(".cellar-item").nth(1)).toHaveAttribute("title", "NEBIUS_API_KEY not set");
    await expect(room.locator(".order-head .stamp")).toHaveText("setup required");
    await expect(room.getByRole("button", { name: "Run audit" })).toBeDisabled();
    // No "Nebius model check failed" banner: the key is missing, not failing.
    await expect(room.getByText("Nebius model check failed")).toHaveCount(0);
    await expect(room.getByText("That didn’t complete")).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await room.screenshot({ path: test.info().outputPath("07-setup-required.png"), animations: "disabled" });
  });

  test("empty flight: glasses sized by persona count, and the order note recomputes", async ({ page }) => {
    const room = await openRoom(page);
    const empty = room.locator(".panel.empty");
    await expect(empty.getByRole("heading", { name: "Nothing poured yet" })).toBeVisible();
    await expect(empty).toContainText("No audits are stored on this server.");
    await expect(empty.locator(".board-stamp")).toHaveText("Empty flight");
    const select = room.getByLabel("Personas");
    await expect(select).toHaveValue("24");
    await expect(select.locator("option")).toHaveText(["16", "24", "48", "100", "200"]);
    // min(6, floor(n / 8)) glasses shown; the caption names the full floor(n / 8) capped at 6.
    const cases: [string, number, number][] = [["24", 3, 3], ["16", 2, 2], ["48", 6, 6], ["100", 6, 6], ["200", 6, 6]];
    for (const [count, glasses, capacity] of cases) {
      await select.selectOption(count);
      await expect(empty.locator(".board-slot")).toHaveCount(glasses);
      await expect(empty.getByRole("img", { name: "Not poured: nothing poured" })).toHaveCount(glasses);
      await expect(empty.locator(".placard-share")).toHaveText(Array(glasses).fill("—"));
      await expect(empty.locator(".board-caption")).toHaveText(`${count} personas fill up to ${capacity} glasses.`);
      await expect(room.locator(".order-note")).toHaveText(`${count} personas × 0 assistants = ${0} live answers, each read by Nemotron. At least 8 personas per glass, so ${count} personas fill up to ${capacity} glasses. Configure an assistant to enable audits.`);
      if (count === "16") await empty.screenshot({ path: test.info().outputPath("08-empty-glasses-16.png"), animations: "disabled" });
      if (count === "48") await empty.screenshot({ path: test.info().outputPath("09-empty-glasses-48.png"), animations: "disabled" });
    }
    // Back to the default: three glasses again.
    await select.selectOption("24");
    await expect(empty.locator(".board-slot")).toHaveCount(3);
  });

  test("filling the order form leaves Run audit disabled, and Enter sends nothing", async ({ page }) => {
    const room = await openRoom(page);
    let posts = 0;
    page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/api/audits")) posts++; });
    await room.getByLabel("Business name").fill("The Bombay Canteen");
    await room.getByLabel("Category").fill("modern Indian restaurant");
    await room.getByLabel("City").fill("Mumbai");
    await room.getByLabel("Personas").selectOption("16");
    await expect(room.getByLabel("Business name")).toHaveValue("The Bombay Canteen");
    const run = room.getByRole("button", { name: "Run audit" });
    await expect(run).toBeDisabled();
    await room.getByLabel("City").press("Enter");
    await run.click({ force: true }); // a disabled submit button ignores the click
    await page.waitForTimeout(500);
    expect(posts, "no audit request leaves the page while keys are missing").toBe(0);
    await expect(room.locator(".pouring")).toHaveCount(0);
    await expect(room.getByRole("heading", { name: "Nothing poured yet" })).toBeVisible();
    await room.locator(".order").screenshot({ path: test.info().outputPath("10-order-form-disabled.png"), animations: "disabled" });
  });

  test("starting an audit from the page answers 503 with a readable Setup message", async ({ page, watch }) => {
    watch.allow(/\/api\/audits$/, 503);
    watch.allow(/\/api\/audits$/, 400);
    await openRoom(page);
    // The same request the Run audit button sends, from the page's own origin.
    const result = await page.evaluate(async () => {
      const send = async (body: unknown) => {
        const response = await fetch("/api/audits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        return { status: response.status, type: response.headers.get("content-type"), body: await response.json() };
      };
      return {
        valid: await send({ brand: "The Bombay Canteen", category: "restaurant", city: "Mumbai", personaCount: 16 }),
        tooFew: await send({ brand: "The Bombay Canteen", category: "restaurant", city: "Mumbai", personaCount: 3 }),
        noBrand: await send({ category: "restaurant", city: "Mumbai", personaCount: 16 }),
      };
    });
    expect(result.valid.status).toBe(503);
    expect(result.valid.type).toContain("application/json");
    expect(result.valid.body).toEqual({ error: "Qloo key not configured: add QLOO_API_KEY to .env.local and restart the server." });
    // Input is validated before keys, so a bad request is a 400 with its own readable message.
    expect(result.tooFew).toEqual({ status: 400, type: expect.stringContaining("application/json"), body: { error: "Use at least 8 personas (one segment needs 8)." } });
    expect(result.noBrand.status).toBe(400);
    expect(result.noBrand.body.error).toMatch(/Required|business name/i);
    // Nothing was stored.
    expect(await page.evaluate(async () => (await fetch("/api/audits")).json())).toEqual([]);
  });

  test("re-pour and agent endpoints answer Setup required / not found without a stored audit", async ({ request }) => {
    const id = "00000000-0000-4000-8000-000000000000";
    const agent = await request.post(`/api/audits/${id}/agent`, { data: { segment: "x" } });
    expect(agent.status()).toBe(503);
    expect(await agent.json()).toEqual({
      error: "setup_required", missing: ["QLOO_API_KEY", "NEBIUS_API_KEY", "OPENAI_API_KEY"],
      message: "Setup required: QLOO_API_KEY; Setup required: NEBIUS_API_KEY; Setup required: OPENAI_API_KEY",
    });
    // The fix route looks the audit up before the key check and before spending a run.
    const before = (await (await request.get("/api/status")).json()).gate;
    const fix = await request.post(`/api/audits/${id}/fix`, { data: {} });
    expect(fix.status()).toBe(404);
    expect(await fix.json()).toEqual({ error: "Audit not found." });
    expect((await (await request.get("/api/status")).json()).gate).toEqual({ running: null, runsToday: before.runsToday });
    const audit = await request.get(`/api/audits/${id}`);
    expect(audit.status()).toBe(404);
    expect(await audit.json()).toEqual({ error: "Audit not found." });
    const evidence = await request.get(`/api/audits/${id}?evidence=1`);
    expect(evidence.status()).toBe(404);
  });

  test("a JSON null (or array) body answers 400 on the re-pour and agent routes, before any lookup or key check", async ({ request }) => {
    const id = "00000000-0000-4000-8000-000000000000";
    const before = (await (await request.get("/api/status")).json()).gate;
    for (const route of ["fix", "agent"]) {
      for (const body of ["null", "[]"]) {
        const response = await request.post(`/api/audits/${id}/${route}`, { headers: { "content-type": "application/json" }, data: body });
        expect(response.status(), `${route} ${body}`).toBe(400);
        expect(await response.json()).toEqual({ error: "Request body must be a JSON object.", code: "invalid_body" });
      }
    }
    expect((await (await request.get("/api/status")).json()).gate).toEqual({ running: null, runsToday: before.runsToday });
  });

  test("no results chrome without an audit: no room nav, no past flights, no report link", async ({ page }) => {
    const room = await openRoom(page);
    await expect(room.getByRole("navigation", { name: "Tasting room sections" })).toHaveCount(0);
    await expect(room.getByRole("navigation", { name: "Saved audits" })).toHaveCount(0);
    await expect(room.getByRole("link", { name: "Printable report" })).toHaveCount(0);
    await expect(room.getByRole("button", { name: /agent loop|Generate fix/ })).toHaveCount(0);
    await shot(page, "11-room-full-page");
  });

  test("an open server: no lock, its caps listed under the order, and a non-JSON POST refused before the key check", async ({ page, request }) => {
    const room = await openRoom(page);
    await expect(room.locator(".locked")).toHaveCount(0);
    await expect(room.locator(".order-caps")).toHaveText("This server runs one flight at a time, caps an audit at 200 personas and the agent at 5 copies and 480 assistant calls, and allows 10 runs an hour per visitor and 100 a day.");
    const form = await request.post("/api/audits", { data: JSON.stringify({ brand: "ab", category: "cd", city: "ef" }), headers: { "content-type": "text/plain" } });
    expect(form.status()).toBe(415);
    expect(await form.json()).toEqual({ code: "json_required", error: "Send the request as JSON (Content-Type: application/json)." });
    const status = await (await request.get("/api/status")).json();
    expect(status.gate).toEqual({ running: null, runsToday: 0 });
    expect(status.runs).toEqual({ locked: false, setupRequired: null, maxPersonas: 200, runsPerIpPerHour: 10, dailyRuns: 100, deadlineSeconds: 900, agentCaps: { maxTries: 5, maxAssistantCalls: 480, maxNemotronTokens: 400000, maxTurns: 20 }, oneAtATime: true });
  });

  test("a status read that never answers ends in 'status unavailable', not an endless Checking", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop-standalone", "the 10 s status timeout is checked once, on the production build");
    test.setTimeout(45_000);
    // Hold the app's own GET /api/status past the room's 10 s timeout; the real server still answers it later.
    await page.route("**/api/status", async (route) => { await new Promise((resolve) => setTimeout(resolve, 12_000)); await route.continue().catch(() => undefined); });
    await page.goto("/#room");
    const room = page.locator("#room");
    await expect(room.getByRole("status").filter({ hasText: "Checking which keys are configured…" })).toBeVisible();
    await expect(room.locator(".order-head .stamp")).toHaveText("checking");
    await expect(room.getByRole("alert").filter({ hasText: "Status unavailable" })).toContainText("Status unavailable: could not read this server's configuration (no answer in 10 s). Reload to try again.", { timeout: 15_000 });
    await expect(room.getByText("Checking which keys are configured…")).toHaveCount(0);
    await expect(room.locator(".order-head .stamp")).toHaveText("status unavailable");
    await expect(room.getByRole("button", { name: "Run audit" })).toBeDisabled();
  });

  test("the image optimizer is off: /_next/image answers 404 for any image", async ({ request }) => {
    // images.unoptimized in next.config.mjs; the app uses no next/image, so the optimizer and its
    // advisories are unreachable on every target.
    for (const url of ["/_next/image?url=%2Ffavicon.ico&w=64&q=75", "/_next/image?url=%2Ficon.svg&w=64&q=75"]) {
      expect((await request.get(url)).status(), url).toBe(404);
    }
    expect((await request.get("/favicon.ico")).status()).toBe(200);
  });

  test('no control in the tasting room is labelled with "log"', async ({ page }) => {
    await openRoom(page);
    expect(await logControls(page)).toEqual([]);
    await expect(page.getByRole("button", { name: /log/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /log/i })).toHaveCount(0);
  });
});
