import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect, expectNoHorizontalScroll, shot } from "./fixtures";

// The standalone build configured as a public demo (e2e/stack.sh, port 3103): runs locked behind a
// run token, a 24-persona cap, TASTEPROBE_FEATURED_AUDIT_ID, and a test-only store seeded from the
// SYNTHETIC fixture (one featured audit plus 13 newer "Visitor Venue N (synthetic)" copies).
// Still no provider key, so nothing here reaches Qloo, Nebius or an assistant.
const FEATURED = "00000000-0000-4000-8000-000000000001";
const FEATURED_NAME = "Fixture Venue (synthetic)";
const token = () => readFileSync(fileURLToPath(new URL("../.run/run-token", import.meta.url)), "utf8").trim();

test.describe("public demo: featured audit, listing, spend guard", () => {
  test("the featured audit opens by default and stays pinned first, however many audits came after it", async ({ page }) => {
    const listing = page.waitForResponse((response) => response.url().endsWith("/api/audits") && response.request().method() === "GET");
    await page.goto("/#room");
    const response = await listing;
    expect(response.headers()["x-total-count"]).toBe("14");
    expect(response.headers()["x-featured-audit"]).toBe(FEATURED);
    const items = await response.json();
    expect(items).toHaveLength(12);
    expect(items[0]).toMatchObject({ id: FEATURED, featured: true, brand: FEATURED_NAME });
    const room = page.locator("#room");
    await expect(room.getByRole("heading", { level: 3, name: FEATURED_NAME, exact: true })).toBeVisible();
    const flights = room.getByRole("navigation", { name: "Saved audits" });
    const glasses = flights.locator(".cellar-flights button");
    await expect(glasses).toHaveCount(12);
    await expect(glasses.first()).toContainText(`Featured${FEATURED_NAME}`);
    await expect(glasses.first()).toHaveClass(/current/);
    await expect(glasses.nth(1)).toContainText("Visitor Venue 1 (synthetic)");
    await expect(flights.locator(".cellar-more")).toHaveText("2 older flights not listed");
    await expect(page.locator(".masthead-live")).toContainText("14 flights poured here");
    // No pre-live copy once the store has audits: no "unverified until first live run" stamp, and
    // the FAQ answers from the store (here the SYNTHETIC test store, so this checks the copy logic).
    await expect(page.getByText("unverified until first live run")).toHaveCount(0);
    const faq = page.locator("#label details").filter({ hasText: "Has it run end to end?" });
    await faq.locator("summary").click();
    await expect(faq.locator("p")).toHaveText(`Yes, on this server: 14 audits stored, each saved by a live run (Qloo, Nemotron on Nebius and the assistants under test); the featured one is ${FEATURED_NAME}. Open one in the tasting room to read every answer behind it. Every glass above the tasting room is an example.`);
    await expect(faq).not.toContainText("Not yet");
    await expectNoHorizontalScroll(page);
    await shot(page, "13-public-featured-results");
  });

  test("Show older flights pages in the rest of the store; every flight opens", async ({ page }) => {
    await page.goto("/#room");
    const room = page.locator("#room");
    await expect(room.getByRole("heading", { level: 3, name: FEATURED_NAME, exact: true })).toBeVisible();
    const flights = room.getByRole("navigation", { name: "Saved audits" });
    const glasses = flights.locator(".cellar-flights button");
    await expect(glasses).toHaveCount(12);
    const older = page.waitForResponse((response) => response.url().includes("/api/audits?offset=12&limit=12"));
    await flights.getByRole("button", { name: "Show older flights" }).click();
    expect((await older).status()).toBe(200);
    await expect(glasses).toHaveCount(14);
    await expect(flights.getByRole("button", { name: "Show older flights" })).toHaveCount(0);
    await expect(flights.locator(".cellar-more")).toHaveCount(0);
    await expect(glasses.nth(12)).toContainText("Visitor Venue 12 (synthetic)");
    await expect(glasses.nth(13)).toContainText("Visitor Venue 13 (synthetic)");
    await expectNoHorizontalScroll(page);
    for (let index = 0; index < 14; index++) {
      const name = (await glasses.nth(index).locator("strong").textContent())!.replace(/^Featured/, "");
      await glasses.nth(index).click();
      await expect(glasses.nth(index)).toHaveClass(/current/);
      await expect(room.getByRole("heading", { level: 3, name, exact: true })).toBeVisible();
    }
  });

  test("GET /api/audits is summaries only: no personas, Qloo ids, affinities or answers", async ({ request }) => {
    const listing = await request.get("/api/audits");
    const items = await listing.json();
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(["answers", "brand", "category", "city", "createdAt", "featured", "id", "origin", "personaSource", "personas", "share"]);
      expect(typeof item.personas).toBe("number");
    }
    const full = await (await request.get(`/api/audits/${FEATURED}`)).text();
    expect(full).toContain('"qlooEntityId"');
    const bytes = (await listing.body()).length;
    expect(bytes, `${bytes} bytes for 12 summaries vs ${full.length} for one full audit`).toBeLessThan(full.length * 2);
    const page2 = await (await request.get("/api/audits?offset=12")).json();
    expect(page2.map((item: { brand: string }) => item.brand)).toEqual(["Visitor Venue 12 (synthetic)", "Visitor Venue 13 (synthetic)"]);
  });

  test("runs are locked: the room says so, offers a token field and lists the server's caps", async ({ page }) => {
    await page.goto("/#room");
    const room = page.locator("#room");
    const locked = room.locator(".locked");
    await expect(locked.getByRole("heading", { name: "Runs are disabled on the public demo" })).toBeVisible();
    await expect(locked).toContainText("Stored flights and their printable reports stay open to read.");
    await expect(locked.getByLabel("Run token")).toHaveAttribute("type", "password");
    await expect(room.locator(".order-caps")).toHaveText("This server runs one flight at a time, caps an audit at 24 personas and the agent at 2 copies and 100 assistant calls, and allows 10 runs an hour per visitor and 100 a day. Runs need the owner’s run token.");
    const personas = room.locator(".order-form select");
    await expect(personas).toHaveValue("24");
    await expect(personas.locator("option")).toHaveText(["16", "24"]);
    await expect(room.getByRole("button", { name: "Run audit" })).toBeDisabled();
    await expect(room.getByRole("button", { name: /Generate/ })).toBeDisabled();
    await expect(room.getByRole("button", { name: "Run agent loop" })).toBeDisabled();
    // The agent selects are clamped to the server's lower caps (2 copies, 100 calls): what they show
    // is what a run would send, not the UI defaults of 3 and 120.
    const tries = room.getByLabel("Copies to try");
    const calls = room.getByLabel("Assistant-call cap");
    await expect(tries.locator("option")).toHaveText(["1", "2"]);
    await expect(tries).toHaveValue("2");
    await expect(calls.locator("option")).toHaveText(["48"]);
    await expect(calls).toHaveValue("48");
    await expectNoHorizontalScroll(page);
    await locked.screenshot({ path: test.info().outputPath("14-runs-locked.png"), animations: "disabled" });
  });

  test("paid routes refuse before the key check: 401 without the token, 415 for non-JSON, 400 over the cap", async ({ request }) => {
    const body = { brand: "ab", category: "cd", city: "ef" };
    const noToken = await request.post("/api/audits", { data: body });
    expect(noToken.status()).toBe(401);
    expect(await noToken.json()).toEqual({ code: "run_locked", error: "Runs are disabled on this server: it needs the run token (TASTEPROBE_RUN_TOKEN) in the X-TasteProbe-Run-Token header. Stored audits stay open to read." });
    const wrong = await request.post("/api/audits", { data: body, headers: { "x-tasteprobe-run-token": "not-the-token" } });
    expect(wrong.status()).toBe(403);
    const form = await request.post("/api/audits", { data: JSON.stringify(body), headers: { "x-tasteprobe-run-token": token(), "content-type": "text/plain" } });
    expect(form.status()).toBe(415);
    const big = await request.post("/api/audits", { data: { ...body, personaCount: 200 }, headers: { "x-tasteprobe-run-token": token() } });
    expect(big.status()).toBe(400);
    expect((await big.json()).error).toBe("This server allows at most 24 personas per audit (TASTEPROBE_MAX_PERSONAS).");
    // Through the guard, the key check answers: Setup required, never a run.
    const keyed = await request.post("/api/audits", { data: body, headers: { "x-tasteprobe-run-token": token() } });
    expect(keyed.status()).toBe(503);
    expect((await keyed.json()).error).toMatch(/QLOO_API_KEY/);
    for (const path of [`/api/audits/${FEATURED}/fix`, `/api/audits/${FEATURED}/agent`]) {
      expect((await request.post(path, { data: {} })).status(), path).toBe(401);
      expect((await request.post(path, { data: {}, headers: { "x-tasteprobe-run-token": token() } })).status(), path).toBe(503);
    }
    // Reads stay open.
    expect((await request.get(`/api/audits/${FEATURED}`)).status()).toBe(200);
    expect((await request.get(`/audits/${FEATURED}/report`)).status()).toBe(200);
  });

  test("switching flights: a slow answer for an earlier choice never replaces the later one", async ({ page }) => {
    await page.goto("/#room");
    const room = page.locator("#room");
    await expect(room.getByRole("heading", { level: 3, name: FEATURED_NAME, exact: true })).toBeVisible();
    const flights = room.getByRole("navigation", { name: "Saved audits" }).locator(".cellar-flights button");
    // Hold the real server's answer for Visitor Venue 1 for 2 s (it is still answered by the server).
    let held = 0;
    await page.route("**/api/audits/00000000-0000-4000-8000-000000000100", async (route) => {
      held++;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.continue().catch(() => undefined);
    });
    await flights.nth(1).click(); // Visitor Venue 1: slow
    await flights.nth(2).click(); // Visitor Venue 2: answered at once
    await expect(room.getByRole("heading", { level: 3, name: "Visitor Venue 2 (synthetic)", exact: true })).toBeVisible();
    await page.waitForTimeout(2_500);
    expect(held).toBe(1);
    await expect(room.getByRole("heading", { level: 3, name: "Visitor Venue 2 (synthetic)", exact: true })).toBeVisible();
    await expect(flights.nth(2)).toHaveClass(/current/);
  });

  test("results view accessibility: glasses are pressed buttons inside list items; heatmap rows say which is selected", async ({ page }) => {
    await page.goto("/#room");
    const board = page.locator("#board");
    await expect(board.getByRole("heading", { name: "The flight" })).toBeVisible();
    expect(await page.locator('button[role="listitem"], [role="listitem"][aria-pressed]').count()).toBe(0);
    const glasses = board.getByRole("list").getByRole("listitem").getByRole("button");
    await expect(glasses).toHaveCount(2);
    // The audit opens on the segment of its last fix attempt: Place keyword, the second glass.
    await expect(glasses.first()).toHaveAttribute("aria-pressed", "false");
    await expect(glasses.nth(1)).toHaveAttribute("aria-pressed", "true");
    const rows = page.locator("#sheet .heatmap tbody th button");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toHaveAttribute("aria-pressed", "false");
    await expect(rows.nth(1)).toHaveAttribute("aria-pressed", "true");
    await glasses.first().click();
    await expect(glasses.first()).toHaveAttribute("aria-pressed", "true");
    await expect(glasses.nth(1)).toHaveAttribute("aria-pressed", "false");
    await expect(rows.first()).toHaveAttribute("aria-pressed", "true");
    await rows.nth(1).click();
    await expect(rows.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(glasses.nth(1)).toHaveAttribute("aria-pressed", "true");
    // No live region floods: nothing in the results view is aria-live except the masthead line.
    expect(await page.locator("#room [aria-live]").count()).toBe(0);
    await expect(page.locator(".persona-source")).toHaveText("Personas from Qloo urn:tag taste tags.");
  });

  test("the featured audit's printable report renders, with its persona source", async ({ page }) => {
    await page.goto(`/audits/${FEATURED}/report`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(FEATURED_NAME);
    await expect(page.locator(".rp-repro")).toContainText("Persona sourceQloo urn:tag taste tags.");
    await expectNoHorizontalScroll(page);
  });
});
