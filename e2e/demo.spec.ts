import { test, expect } from "@playwright/test";
// Import attribute is required: Playwright runs specs as native ESM, which rejects a bare
// JSON import.
import demoEn from "../app/locales/en/demo.json" with { type: "json" };

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

    // Colour must never be the only carrier of status: each row states it in words. Labels come
    // from the locale file rather than being hardcoded here, so a mis-rendered or missing
    // translation fails the assertion instead of slipping past an English-only regex.
    const labels = Object.values(demoEn.board.status);
    const statuses = page.getByTestId("demo-board-status");
    await expect(statuses).toHaveCount(5);
    for (const status of await statuses.allInnerTexts()) {
      expect(labels).toContain(status.trim());
    }
  });

  test("primary CTA lands on the real sign-up route", async ({ page }) => {
    await page.goto("/demo");
    await page.getByTestId("demo-hero-cta").click();
    await page.waitForURL("**/sign-up");
    await expect(page.getByTestId("signup-email")).toBeVisible();
  });

  test("runs its own scoped design system without leaking into the app", async ({
    page,
  }) => {
    // The surface overrides the same token names the rest of the app uses, scoped to
    // [data-surface="loadline"]. Two things must stay true: the scope really applies, and
    // nothing escapes it. A stray token in app.css would break the second half silently.
    await page.goto("/demo");
    const scoped = await page.evaluate(() => {
      const el = document.querySelector('[data-surface="loadline"]');
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        background: s.getPropertyValue("--background").trim(),
        primary: s.getPropertyValue("--primary").trim(),
        radius: s.getPropertyValue("--radius").trim(),
      };
    });
    expect(scoped).not.toBeNull();
    expect(scoped!.background).toBe("oklch(0.121 0.017 7.8)");
    expect(scoped!.primary).toBe("oklch(0.592 0.219 24.2)");
    expect(scoped!.radius).toBe("0.375rem");

    // The reference this surface is locked to forbids light backgrounds, so the scope opts out
    // of the app's theme toggle: its tokens must not change when `.dark` is applied.
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    const afterDark = await page.evaluate(() =>
      getComputedStyle(
        document.querySelector('[data-surface="loadline"]')!
      ).getPropertyValue("--background").trim()
    );
    expect(afterDark).toBe(scoped!.background);

    // ...and the starter's own surfaces keep the starter's tokens.
    await page.goto("/");
    const root = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return {
        background: s.getPropertyValue("--background").trim(),
        radius: s.getPropertyValue("--radius").trim(),
        scopedElements: document.querySelectorAll("[data-surface]").length,
      };
    });
    expect(root.background).toBe("oklch(1 0 0)");
    expect(root.radius).toBe("0.625rem");
    expect(root.scopedElements).toBe(0);
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
