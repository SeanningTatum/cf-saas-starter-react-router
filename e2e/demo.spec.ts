import { test, expect } from "@playwright/test";
// Import attribute is required: Playwright runs specs as native ESM, which rejects a bare
// JSON import.
import demoEn from "../app/locales/en/demo.json" with { type: "json" };

/**
 * `/demo` — the sample SaaS marketing surface (Loadline, "Guide Sign" direction).
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

    // The hero sign opens on the dark load's climbing age, not on a decorative number, and the
    // hazard placard next to it says what the number means.
    await expect(page.getByTestId("demo-monument-figure")).toHaveText(/^\d+$/);
    await expect(page.getByTestId("demo-hazard")).toContainText(
      demoEn.sign.hazard
    );

    // Status is stated in words on every row — the surface has no colour-only encoding, and the
    // dark load's row is orange *and* labelled.
    const labels = Object.values(demoEn.manifest.status).map((l) =>
      l.toUpperCase()
    );
    const rows = board.locator("tbody tr");
    const statuses = (await rows.locator("td:nth-child(4)").allInnerTexts())
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statuses.length).toBe(5);
    for (const status of statuses) {
      expect(labels).toContain(status.toUpperCase());
    }
  });

  test("marketing copy lives inside the manifest as row annotations", async ({
    page,
  }) => {
    // Regression guard for the composition itself: an earlier version of this page put its
    // argument in a separate feature-card section, which is the generic pattern the rebuild
    // removed. If these lines are no longer in the table, that regression happened.
    await page.goto("/demo");

    const board = page.getByTestId("demo-dispatch-board");
    for (const annotation of Object.values(demoEn.manifest.annotations)) {
      await expect(board.getByText(annotation, { exact: false })).toBeVisible();
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
    // Asphalt road-marking rules and square corners are the surface's structure.
    expect(scoped!.border.toLowerCase()).toBe("#101010");
    expect(scoped!.radius).toBe("0rem");

    // The reference is a light system, so the scope must ignore the app's dark theme rather
    // than inherit a canvas the lock rejects.
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    const afterDark = await page.evaluate(() =>
      getComputedStyle(document.querySelector('[data-surface="loadline"]')!)
        .getPropertyValue("--background")
        .trim()
    );
    expect(afterDark.toLowerCase()).toBe("#ffffff");

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
    expect(root.border.toLowerCase()).not.toBe("#101010");
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
