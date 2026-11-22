import { test, expect, type Page } from "@playwright/test";

/**
 * Hold every script request until `release()` is called, so the server-
 * rendered page sits on screen unhydrated: the window where a submit used to
 * become a native GET with the password in the query string (issue #49).
 */
async function holdScripts(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() === "script") await gate;
    await route.continue();
  });
  return release;
}

/**
 * The auth forms keep submit disabled until React hydrates, and hydration
 * resets anything typed before it, so wait for the button before filling.
 * On a cold dev server the first page load can die on Vite's "504 Outdated
 * Optimize Dep" and never hydrate (issue #50); one reload recovers it.
 */
async function waitForHydration(page: Page, submitTestId: string) {
  const submit = page.getByTestId(submitTestId);
  const hydrated = await expect(submit)
    .toBeEnabled({ timeout: 15_000 })
    .then(() => true, () => false);
  if (hydrated) return;
  await page.reload();
  await expect(submit).toBeEnabled({ timeout: 30_000 });
}

/**
 * Authentication golden path.
 *
 * Covers the only flow that genuinely matters end-to-end on this boilerplate:
 *   1. New user signs up → lands on /dashboard.
 *   2. User signs out → bounced back to /login when revisiting /dashboard.
 *   3. Same user signs in with their credentials → lands on /dashboard again.
 *
 * Other surfaces (admin, file upload, analytics) are gated by an admin role.
 * `bun run db:seed` now seeds `admin@preview.local` / `Password123!` (plus
 * a plain user and a banned user) into local D1 — use those fixtures for
 * future admin-flow specs instead of a direct D1 UPDATE.
 */
test.describe("Authentication", () => {
  // Each run uses a fresh email so re-runs against a persistent local D1
  // don't collide with the previous run's user.
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  const password = "E2EPass123!";
  const name = "E2E User";

  test("signup → dashboard, signout → login, signin → dashboard", { tag: "@golden" }, async ({ page }) => {
    // 1. Sign up
    await page.goto("/sign-up");
    await waitForHydration(page, "signup-submit");
    await page.fill('[data-testid="signup-name"]', name);
    await page.fill('[data-testid="signup-email"]', email);
    await page.fill('[data-testid="signup-password"]', password);
    await page.fill('[data-testid="signup-confirm-password"]', password);
    await page.click('[data-testid="signup-submit"]');
    await page.waitForURL("/dashboard");
    await expect(page.getByTestId("dashboard-account")).toBeVisible();

    // 2. Sign out via the Better Auth endpoint, then verify the dashboard
    //    redirects to /login when there's no session.
    const signOutStatus = await page.evaluate(() =>
      fetch("/api/auth/sign-out", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).then((r) => r.status),
    );
    expect(signOutStatus).toBe(200);

    await page.goto("/dashboard");
    await page.waitForURL("/login");
    await waitForHydration(page, "login-submit");

    // 3. Sign back in with the same credentials.
    await page.fill('[data-testid="login-email"]', email);
    await page.fill('[data-testid="login-password"]', password);
    await page.click('[data-testid="login-submit"]');
    await page.waitForURL("/dashboard");
    await expect(page.getByTestId("dashboard-account")).toBeVisible();
  });

  test("login form rejects bad credentials", { tag: "@error" }, async ({ page }) => {
    await page.goto("/login");
    await waitForHydration(page, "login-submit");
    await page.fill('[data-testid="login-email"]', "nobody@test.local");
    await page.fill('[data-testid="login-password"]', "WrongPass123!");
    await page.click('[data-testid="login-submit"]');
    await expect(page.getByTestId("login-error")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});

/**
 * Catches issue #69: a banned account signs in. Fails if the ban guard on
 * session create is lost, or if the seeded `banned@preview.local` fixture
 * (scripts/seed-preview.ts) is no longer banned. Asserts on the ban message,
 * so a wrong-password error cannot pass it by accident.
 */
test.describe("Banned account", () => {
  test("banned account is refused at login", { tag: "@error" }, async ({ page }) => {
    await page.goto("/login");
    await waitForHydration(page, "login-submit");
    await page.getByTestId("login-email").fill("banned@preview.local");
    await page.getByTestId("login-password").fill("Password123!");
    await page.getByTestId("login-submit").click();

    await expect(page.getByRole("alert")).toContainText(/banned/i);
    await expect(page).toHaveURL(/\/login$/);

    // No session was made: the dashboard sends the visitor back to /login.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });
});

// Catches issue #49: a submit before hydration must never put a field in the URL.
test.describe("Auth forms before hydration", () => {
  const forms = [
    { path: "/sign-up", prefix: "signup", passwordFields: ["signup-password", "signup-confirm-password"] },
    { path: "/login", prefix: "login", passwordFields: ["login-password"] },
  ];

  for (const { path, prefix, passwordFields } of forms) {
    test(`${path} ignores an early submit and keeps the password out of the URL`, async ({ page }) => {
      const release = await holdScripts(page);
      await page.goto(path, { waitUntil: "commit" });

      const form = page.getByTestId(`${prefix}-form`);
      const submit = page.getByTestId(`${prefix}-submit`);
      await expect(form).toBeVisible();
      // Backstop if JS never loads: a native submit posts the body, never a query string.
      await expect(form).toHaveAttribute("method", "post");
      await expect(submit).toBeDisabled();

      await page.getByTestId(`${prefix}-email`).fill("early@test.local");
      for (const field of passwordFields) await page.getByTestId(field).fill("EarlyPass123!");
      await submit.click({ force: true });
      await page.getByTestId(passwordFields[0]).press("Enter");

      expect(new URL(page.url()).search).toBe("");
      expect(page.url()).not.toContain("EarlyPass123");

      // Once hydrated, the same form works.
      release();
      await waitForHydration(page, `${prefix}-submit`);
      expect(new URL(page.url()).pathname).toBe(path);
    });
  }
});
