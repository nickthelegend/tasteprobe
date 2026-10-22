import { test as base, expect, type Page } from "@playwright/test";

type Allowed = { url: RegExp; status: number };

/**
 * Every test gets a `watch` that records page errors, console errors, failed same-origin requests
 * and same-origin HTTP errors, and asserts at the end that there were none. A test may `allow()` one
 * status on one URL when that status is the product's honest answer (the 503 Setup required).
 */
export const test = base.extend<{ watch: { allow: (url: RegExp, status: number) => void } }>({
  watch: [
    async ({ page }, use, testInfo) => {
      const allowed: Allowed[] = [];
      const problems: string[] = [];
      const isAllowed = (url: string, status: number) => allowed.some((item) => item.status === status && item.url.test(url));
      const sameOrigin = (url: string) => {
        try { return new URL(url).origin === new URL(testInfo.project.use.baseURL!).origin; } catch { return false; }
      };
      page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const at = message.location().url || "";
        const status = /status of (\d{3})/.exec(message.text());
        if (status && isAllowed(at, Number(status[1]))) return;
        problems.push(`console.error: ${message.text()} @ ${at}`);
      });
      page.on("requestfailed", (request) => {
        if (!sameOrigin(request.url())) return;
        const why = request.failure()?.errorText || "";
        if (why === "net::ERR_ABORTED") return; // a navigation away cancels in-flight requests
        problems.push(`requestfailed: ${request.method()} ${request.url()} ${why}`);
      });
      page.on("response", (response) => {
        if (!sameOrigin(response.url()) || response.status() < 400) return;
        if (isAllowed(response.url(), response.status())) return;
        problems.push(`HTTP ${response.status()}: ${response.request().method()} ${response.url()}`);
      });
      await use({ allow: (url, status) => allowed.push({ url, status }) });
      if (problems.length) await testInfo.attach("problems", { body: problems.join("\n") });
      expect(problems, "page errors, console errors or failed same-origin requests").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export const isMobile = (name: string) => name.startsWith("mobile");

/** No horizontal page scroll (the 375 px check). */
export async function expectNoHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, `page scrollWidth ${scroll} > clientWidth ${client}`).toBeLessThanOrEqual(client);
}

/** The element's top landed near the top of the viewport (an anchor jump worked). */
export async function expectInViewport(page: Page, selector: string) {
  await expect.poll(() => page.evaluate((sel) => {
    const box = document.querySelector(sel)!.getBoundingClientRect();
    return box.top >= -2 && box.top < innerHeight * 0.6;
  }, selector), { message: `${selector} scrolled into view` }).toBe(true);
}

/** Every element a user can activate whose visible label or accessible name contains "log". */
export async function logControls(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll("button, a[href], summary, [role=button], input[type=button], input[type=submit]")]
    .map((element) => `${element.textContent ?? ""} ${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("title") ?? ""}`.trim())
    .filter((label) => /log/i.test(label.replace(/\b(catalog|logo)\b/gi, ""))));
}

/** A named full-page screenshot kept with the test's output (copied into the report). */
export async function shot(page: Page, name: string) {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true, animations: "disabled" });
}
