import { test, expect } from "@playwright/test";
// Import attribute is required: Playwright runs specs as native ESM, which rejects a bare
// JSON import.
import demoEn from "../app/locales/en/demo.json" with { type: "json" };

/**
 * `/demo` — the sample SaaS marketing surface (Loadline).
 *
 * The page is static marketing, so this spec guards the things a unit test cannot see and that
 * would quietly gut the design if they broke:
 *   1. The manifest reaches the browser, with status stated in words (colour is never the only
 *      carrier — and on this surface there is no colour at all).
 *   2. The marketing copy is *inside* the manifest as row annotations. If those disappear, the
 *      page has silently reverted to a separate feature section.
 *   3. The scoped design system applies and does not leak into the rest of the app.
 *   4. The CTA reaches the real sign-up route, and the page never scrolls sideways on a phone.
 *
 * Constraints these encode: `.brain/rules/frontend.md` (design gate + scoped design systems)
 * and `.brain/features/sample-saas-landing/sample-saas-landing.md` (the reference lock).
 */
test.describe("Demo landing (/demo)", () => {
  test("manifest renders with status stated in words", async ({ page }) => {
    await page.goto("/demo");

    const board = page.getByTestId("demo-dispatch-board");
    await expect(board).toBeVisible();

    // The page leads with the product's own board, and the dark load's age is a live figure.
    await expect(page.getByTestId("demo-monument-figure")).toHaveText(/^\d+$/);

    // Status is stated in words on every row — the surface has no colour-only encoding, and the
    // dark load's row is orange *and* labelled.
    const labels = Object.values(demoEn.manifest.status).map((l) =>
      l.toUpperCase()
    );
    // Select by testid rather than column index: the panel's column count is a design decision
    // and this assertion is about status always being stated in words.
    const statusCells = board.getByTestId("demo-board-status");
    await expect(statusCells).toHaveCount(5);
    for (const status of await statusCells.allInnerTexts()) {
      expect(labels).toContain(status.trim().toUpperCase());
    }
  });

  test("shows real product surfaces, not marketing illustrations", async ({
    page,
  }) => {
    // Regression guard for the composition: this page argues by showing the product. Earlier
    // versions argued in feature cards with no product visual at all, which is the generic
    // pattern. If these event lines vanish, that regression happened.
    await page.goto("/demo");

    for (const line of demoEn.detail.checkcall.lines) {
      await expect(page.getByText(line, { exact: false })).toBeVisible();
    }
    for (const line of demoEn.detail.invoice.lines) {
      await expect(page.getByText(line, { exact: false })).toBeVisible();
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
    // [data-surface="loadline"]. Two things must hold: the scope applies, and nothing escapes.
    await page.goto("/demo");
    const scoped = await page.evaluate(() => {
      const el = document.querySelector('[data-surface="loadline"]');
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        border: s.getPropertyValue("--border").trim(),
        radius: s.getPropertyValue("--radius").trim(),
        letterSpacing: s.letterSpacing,
      };
    });
    expect(scoped).not.toBeNull();
    // Hairline borders at low alpha and a soft radius are this surface's own language.
    expect(scoped!.border).toContain("rgba(255, 255, 255");
    expect(scoped!.radius).toBe("0.75rem");

    // The surface keeps its own theme whichever way the app toggle is set.
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    const afterDark = await page.evaluate(() =>
      getComputedStyle(document.querySelector('[data-surface="loadline"]')!)
        .getPropertyValue("--background")
        .trim()
    );
    expect(afterDark.toLowerCase()).toBe("#08090a");

    // ...and the starter's own surfaces keep the starter's tokens.
    await page.goto("/");
    const root = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return {
        radius: s.getPropertyValue("--radius").trim(),
        border: s.getPropertyValue("--border").trim(),
        scopedElements: document.querySelectorAll("[data-surface]").length,
      };
    });
    expect(root.radius).toBe("0.625rem");
    expect(root.border).not.toContain("rgba(255, 255, 255");
    expect(root.scopedElements).toBe(0);
  });

  test("does not scroll sideways on a phone viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/demo");

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBe(clientWidth);
    await expect(page.getByTestId("demo-dispatch-board")).toBeVisible();
  });
});
