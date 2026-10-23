import { test, expect } from "@playwright/test";

/**
 * Landing-page harness section.
 *
 * Pins the brain-axi 0.3.0 copy: three pillars (Brain / Skills / Verification
 * gates) with their path labels, a commands block that names `brain` commands
 * and none of the removed slash commands, and no raw i18n keys in either
 * locale — a renamed key renders as `harness.pillars.…` text.
 */
test.describe("Home — harness section", () => {
  test("en: pillars and commands reflect the brain CLI", async ({ page }) => {
    await page.goto("/");
    const section = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "An agent harness, not just a stack" }) });
    await section.scrollIntoViewIfNeeded();

    for (const title of ["Brain", "Skills", "Verification gates"]) {
      await expect(section.getByText(title, { exact: true })).toBeVisible();
    }
    for (const label of [".brain/brain.db", "brain-axi plugin"]) {
      await expect(section.getByText(label, { exact: true })).toBeVisible();
    }

    const commands = section.locator("pre code");
    await expect(commands).toContainText("brain verify");
    await expect(commands).toContainText("brain features ship");
    for (const gone of ["/start-task", "/verify-done", "/ship-feature", ".brain/recipes"]) {
      await expect(commands).not.toContainText(gone);
    }

    await expect(page.locator("body")).not.toContainText("harness.pillars.");
  });

  test("zh: pillar copy is translated, unsupported locale is rejected", async ({ page }) => {
    await page.goto("/");
    const ok = await page.evaluate(async () =>
      (await fetch("/api/set-locale", { method: "POST", body: new URLSearchParams({ lng: "zh" }) })).status
    );
    expect(ok).toBe(200);

    const rejected = await page.evaluate(async () =>
      (await fetch("/api/set-locale", { method: "POST", body: new URLSearchParams({ lng: "xx" }) })).status
    );
    expect(rejected).toBe(400);

    await page.reload();
    const body = page.locator("body");
    await expect(body).toContainText("brain-axi 插件把方法串成一条链");
    await expect(body).not.toContainText("harness.pillars.");
  });
});
