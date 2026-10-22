import { test, expect, expectInViewport, expectNoHorizontalScroll, isMobile, logControls, shot } from "./fixtures";

const EXAMPLE = "Example, not a real audit";
const REPO = "https://github.com/nickthelegend/tasteprobe";

test.describe("landing: the tasting sheet", () => {
  test("loads with the live cellar line: every key missing, no flights poured", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("TasteProbe — does AI recommend you to your own audience?");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Does AI recommend you to your own audience?");
    // The masthead is filled from /api/status and /api/audits, not hardcoded.
    await expect(page.locator(".masthead-live")).toHaveText("Qloo key missing · Nebius key missing · no assistant · no flights poured on this server");
    await expect(page.locator(".masthead-live i")).toHaveClass("bad");
    await expectNoHorizontalScroll(page);
    await shot(page, "01-landing");
  });

  test("hero flight board is stamped as an example and has four labelled glasses", async ({ page }) => {
    await page.goto("/");
    const hero = page.locator(".hero .board");
    await expect(hero.locator(".board-stamp")).toHaveText(EXAMPLE);
    await expect(hero.locator(".board-caption")).toContainText(`${EXAMPLE}.`);
    await expect(hero.locator(".board-caption")).toContainText("Real flights appear in the tasting room only after live Qloo, Nebius and assistant calls.");
    await expect(hero.locator(".placard-name")).toHaveText(["Cuisine tags", "Ambience tags", "Offering tags", "Audience tags"]);
    await expect(hero.locator(".placard-share")).toHaveText(["58%", "31%", "12%", "0%"]);
    await expect(hero.getByRole("img", { name: /^Cuisine tags: 58% of answers recommend the venue, 95% interval/ })).toBeVisible();
    // Every surface that shows made-up levels carries the stamp: hero, glass anatomy, re-pour.
    await expect(page.locator(".board-stamp", { hasText: EXAMPLE })).toHaveCount(3);
    await hero.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath("02-example-flight.png"), animations: "disabled" });
  });

  test("wine-list steps: seven numbered courses with their sponsor tags", async ({ page }) => {
    await page.goto("/");
    const courses = page.locator("#flight .menu-list > li");
    await expect(courses).toHaveCount(7);
    await expect(courses.locator(".menu-no")).toHaveText(["01", "02", "03", "04", "05", "06", "07"]);
    await expect(courses.locator("h3 > span")).toHaveText([
      "Source the palates", "Seat the personas", "Pour the question", "Take tasting notes",
      "Measure the glass", "Re-pour three flights", "Keep the sommelier’s notebook",
    ]);
    await expect(courses.locator("h3 em")).toHaveText(["Qloo Taste AI", "≥ 8 per glass", "brand never named", "NVIDIA Nemotron", "Wilson 95%", "paired bootstrap", "tool calling"]);
    await page.locator("#flight").scrollIntoViewIfNeeded();
    await page.locator("#flight").screenshot({ path: test.info().outputPath("03-wine-list.png"), animations: "disabled" });
  });

  test("glass anatomy: one example glass with fill, both pour lines and four definitions", async ({ page }) => {
    await page.goto("/");
    const figure = page.locator("#glass .anatomy-glass");
    await expect(figure.locator(".board-stamp")).toHaveText(EXAMPLE);
    await expect(figure.getByRole("img")).toHaveAccessibleName(`${EXAMPLE}: a glass filled to 31% with pour lines at 18% and 47%`);
    await expect(figure.locator(".anno")).toHaveText(["fill · 31%", "upper pour line · 47%", "lower pour line · 18%"]);
    await expect(page.locator("#glass .anatomy-list dt")).toHaveText(["Fill level", "Pour lines", "Placard", "Tasting notes"]);
    // The annotations stay inside the figure (no overflow at 375 px).
    const inside = await figure.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return [...element.querySelectorAll(".anno")].every((anno) => { const a = anno.getBoundingClientRect(); return a.left >= box.left - 1 && a.right <= box.right + 1; });
    });
    expect(inside, "anatomy annotations stay inside the figure").toBe(true);
    await figure.scrollIntoViewIfNeeded();
    await page.locator("#glass").screenshot({ path: test.info().outputPath("04-glass-anatomy.png"), animations: "disabled" });
  });

  test("three flights: baseline, placebo and fix, with the lift rule and the notebook rules", async ({ page }) => {
    await page.goto("/");
    const repour = page.locator("#repour");
    await expect(repour.locator(".board-stamp")).toHaveText(EXAMPLE);
    await expect(repour.locator(".placard-name")).toHaveText(["Baseline", "Placebo", "Fix"]);
    await expect(repour.locator(".placard-share")).toHaveText(["12%", "20%", "38%"]);
    await expect(repour.locator(".repour-math")).toContainText("Lift = fix − placebo");
    const notebook = repour.getByRole("article", { name: "How the sommelier's notebook works" });
    await expect(notebook.locator("header")).toContainText("rules, not a run");
    await expect(notebook.locator("li b")).toHaveText(["Tools", "Probe", "Stop", "Enforced"]);
    await repour.scrollIntoViewIfNeeded();
    await repour.screenshot({ path: test.info().outputPath("05-three-flights.png"), animations: "disabled" });
  });

  test("back-label FAQ: six questions, first open, each one opens and closes on click", async ({ page }) => {
    await page.goto("/");
    const items = page.locator("#label details");
    await expect(items).toHaveCount(6);
    await expect(items.locator("summary")).toHaveText([
      "Where do the personas come from?", "Does the assistant know who is being audited?", "How sure are the numbers?",
      "What does a fix change?", "What do I need to run it?", "Has it run end to end?",
    ]);
    await expect(items.nth(0)).toHaveAttribute("open", "");
    for (let index = 0; index < 6; index++) {
      const item = items.nth(index);
      const body = item.locator("p");
      const wasOpen = await item.evaluate((element) => (element as HTMLDetailsElement).open);
      await item.locator("summary").click();
      if (wasOpen) await expect(body).toBeHidden(); else await expect(body).toBeVisible();
      await item.locator("summary").click();
      if (wasOpen) await expect(body).toBeVisible(); else await expect(body).toBeHidden();
    }
    // Open them all for the record, and check what the label promises about missing keys.
    for (let index = 1; index < 6; index++) await items.nth(index).locator("summary").click();
    await expect(items.nth(4)).toContainText("Without them the tasting room says Setup required, names the missing variable and keeps the Run button disabled. Nothing is simulated.");
    await expect(items.nth(5)).toContainText("Not yet against live keys from this repo.");
    await page.locator("#label").screenshot({ path: test.info().outputPath("06-back-label.png"), animations: "disabled" });
  });

  test("header nav anchors jump to each course (desktop; the course nav is hidden below 900 px)", async ({ page }, info) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    if (isMobile(info.project.name)) {
      await expect(nav).toBeHidden();
      return;
    }
    const targets: [RegExp, string][] = [[/The flight/, "#flight"], [/Reading a glass/, "#glass"], [/Re-pour/, "#repour"], [/Back label/, "#label"]];
    for (const [name, hash] of targets) {
      await nav.getByRole("link", { name }).click();
      await expect(page).toHaveURL(new RegExp(`${hash}$`));
      await expectInViewport(page, hash);
    }
  });

  test("calls to action: Tasting room, Pour a flight, How it is poured, and the logo back to top", async ({ page }) => {
    await page.goto("/");
    await page.locator(".sheet-head").getByRole("link", { name: "Tasting room" }).click();
    await expect(page).toHaveURL(/#room$/);
    await expectInViewport(page, "#room");
    await page.getByRole("link", { name: "TasteProbe home" }).first().click();
    await expect(page).toHaveURL(/#top$/);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(5);
    await page.getByRole("link", { name: "Pour a flight" }).click();
    await expect(page).toHaveURL(/#room$/);
    await expectInViewport(page, "#room");
    await page.getByRole("link", { name: "TasteProbe home" }).first().click();
    await page.getByRole("link", { name: "How it is poured" }).click();
    await expect(page).toHaveURL(/#flight$/);
    await expectInViewport(page, "#flight");
    // Footer logo goes back to the top as well.
    await page.locator(".colophon").getByRole("link", { name: "TasteProbe home" }).click();
    await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(5);
  });

  test("outbound links point at the public repo and open in place", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Source on GitHub" })).toHaveAttribute("href", REPO);
    await expect(page.getByRole("link", { name: "How the numbers are made" })).toHaveAttribute("href", `${REPO}#how-the-numbers-are-made`);
    await expect(page.locator(".colophon").getByRole("link", { name: "github.com/nickthelegend/tasteprobe" })).toHaveAttribute("href", REPO);
    // Every other link on the page is a same-page anchor whose target exists.
    const anchors = await page.locator('a[href^="#"]').evaluateAll((links) => links.map((link) => link.getAttribute("href")!));
    expect(anchors.length).toBeGreaterThan(5);
    for (const hash of new Set(anchors)) expect(await page.locator(hash).count(), `${hash} exists`).toBe(1);
  });

  test("reduced motion: glasses render filled with no pour animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const liquid = page.locator(".hero .glass-liquid").first();
    await expect(liquid).toBeVisible();
    expect(await liquid.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("auto");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    expect(await liquid.evaluate((element) => getComputedStyle(element).animationName)).toBe("pour");
  });

  test('no control on the landing is labelled with "log"', async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".masthead-live")).not.toHaveText("Checking the cellar…");
    expect(await logControls(page)).toEqual([]);
    await expect(page.getByRole("button", { name: /log/i })).toHaveCount(0);
  });
});
