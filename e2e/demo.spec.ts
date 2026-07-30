import { test, expect } from "@playwright/test";

/**
 * `/demo` — the sample SaaS landing surface (Loadline).
 *
 * The page is static marketing, so this spec guards the three things that can actually
 * break and that a unit test cannot see:
 *   1. The route renders and the dispatch board reaches the browser with derived filter
 *      counts (the board is the page's whole argument — an empty frame is a broken page).
 *   2. Status meaning survives without colour — every row shows a text label.
 *   3. The primary CTA reaches the real `/sign-up` route, and the page does not scroll
 *      sideways on a phone (the defect the pre-merge browser walk actually caught).
 *
 * Design constraints these assertions encode live in `.brain/rules/frontend.md` and
 * `.brain/features/sample-saas-landing/sample-saas-landing.md`.
 */
test.describe("Demo landing (/demo)", () => {
  test("board renders with derived counts and labelled statuses", async ({ page }) => {
    await page.goto("/demo");

    const board = page.getByTestId("demo-dispatch-board");
    await expect(board).toBeVisible();

    const rows = board.locator("tbody tr");
    await expect(rows).toHaveCount(5);

    // Filter pills are derived from the rows, not hardcoded — "All" must equal the row
    // count, and the per-status pills must sum to it.
    await expect(page.getByTestId("demo-filter-all")).toContainText("5");
    await expect(page.getByTestId("demo-filter-rolling")).toContainText("3");
    await expect(page.getByTestId("demo-filter-late")).toContainText("1");
    await expect(page.getByTestId("demo-filter-delivered")).toContainText("1");

    // Colour must never be the only carrier of status: each row states it in words.
    const statuses = page.getByTestId("demo-board-status");
    await expect(statuses).toHaveCount(5);
    for (const status of await statuses.allInnerTexts()) {
      expect(status.trim()).toMatch(/^(Rolling|Late|Delivered)$/);
    }
  });

  test("primary CTA lands on the real sign-up route", async ({ page }) => {
    await page.goto("/demo");
    await page.getByTestId("demo-hero-cta").click();
    await page.waitForURL("**/sign-up");
    await expect(page.getByTestId("signup-email")).toBeVisible();
  });

  test("does not scroll sideways on a phone viewport", async ({ page }) => {
    // Regression guard: the header's control cluster overflowed a 390px viewport before
    // the chip and sign-in link were hidden below `sm`.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/demo");

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBe(clientWidth);

    // The board itself is allowed — and expected — to scroll inside its own container.
    await expect(page.getByTestId("demo-dispatch-board")).toBeVisible();
  });
});
