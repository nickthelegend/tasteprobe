import { test, expect, expectInViewport, expectNoHorizontalScroll, logControls, shot } from "./fixtures";

test.describe("printable report with an empty store", () => {
  for (const id of ["00000000-0000-4000-8000-000000000000", "not-a-real-id"]) {
    test(`/audits/${id}/report shows the honest empty state`, async ({ page }) => {
      const response = await page.goto(`/audits/${id}/report`);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle("TasteProbe report");
      await expect(page.locator(".rp-masthead")).toHaveText(/TasteProbe · audit report\s*nothing to print/i);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("No audits stored yet");
      await expect(page.locator(".rp-empty-body p")).toHaveText("This server has no stored audits. A report appears here only after a live audit with Qloo, Nebius and assistant keys completes. Nothing is shown as an example.");
      await expect(page.getByRole("img", { name: "Empty glass: no audit" })).toBeVisible();
      await expect(page.locator(".rp-stored")).toHaveCount(0);
      // Nothing to print: no print button on an empty report.
      await expect(page.getByRole("button", { name: "Print or save as PDF" })).toHaveCount(0);
      await expectNoHorizontalScroll(page);
      if (id === "not-a-real-id") await shot(page, "12-report-empty");
    });
  }

  test("Back to the tasting room returns to the room's Setup required state", async ({ page }) => {
    await page.goto("/audits/00000000-0000-4000-8000-000000000000/report");
    await page.getByRole("link", { name: "Back to the tasting room" }).click();
    await expect(page).toHaveURL(/\/#room$/);
    await expect(page.getByRole("heading", { name: "Setup required" })).toBeVisible();
    await expectInViewport(page, "#room");
  });

  test('no control on the report page is labelled with "log"', async ({ page }) => {
    await page.goto("/audits/00000000-0000-4000-8000-000000000000/report");
    expect(await logControls(page)).toEqual([]);
  });
});

test("an unknown page renders the not-found page, not a crash", async ({ page, watch }) => {
  watch.allow(/\/no-such-page$/, 404);
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
});
