import { test, expect } from "@playwright/test";

/**
 * Landing-page harness section.
 *
 * Pins the current copy: three pillars (Specs & tickets / Skills / Verification
 * gates) with their path labels, a commands block that names the planning
 * skills and `./scripts/verify.sh` and no `brain` commands, and no raw i18n keys in either
 * locale — a renamed key renders as `harness.pillars.…` text.
 */
test.describe("Home — harness section", () => {
  test("en: pillars and commands reflect specs, skills and gates", async ({ page }) => {
    await page.goto("/");
    const section = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "An agent harness, not just a stack" }) });
    await section.scrollIntoViewIfNeeded();

    for (const title of ["Specs & tickets", "Skills", "Verification gates"]) {
      await expect(section.getByText(title, { exact: true })).toBeVisible();
    }
    for (const label of ["GitHub issues", "skills-lock.json", "scripts/verify.sh"]) {
      await expect(section.getByText(label, { exact: true })).toBeVisible();
    }

    const commands = section.locator("pre code");
    for (const cmd of ["/grill-me", "/to-spec", "/to-tickets", "./scripts/verify.sh"]) {
      await expect(commands).toContainText(cmd);
    }
    for (const gone of ["brain", "/start-task", "/verify-done", "/ship-feature"]) {
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
    await expect(body).toContainText("规格与工单");
    await expect(body).not.toContainText("brain-axi");
    await expect(body).not.toContainText("harness.pillars.");
  });
});
