import { test, expect } from "@playwright/test";

/**
 * Authentication golden path.
 *
 * Covers the only flow that genuinely matters end-to-end on this boilerplate:
 *   1. New user signs up → lands on /dashboard.
 *   2. User signs out → bounced back to /login when revisiting /dashboard.
 *   3. Same user signs in with their credentials → lands on /dashboard again.
 *
 * Other surfaces (admin, file upload, analytics) are gated by an admin role
 * that has to be seeded with a direct D1 UPDATE — out of scope for an e2e
 * harness that has no seed step. Test those with unit tests + manual checks
 * until a seed hook exists.
 */
test.describe("Authentication", () => {
  // Each run uses a fresh email so re-runs against a persistent local D1
  // don't collide with the previous run's user.
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
  const password = "E2EPass123!";
  const name = "E2E User";

  test("signup → dashboard, signout → login, signin → dashboard", async ({ page }) => {
    // 1. Sign up
    await page.goto("/sign-up");
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

    // 3. Sign back in with the same credentials.
    await page.fill('[data-testid="login-email"]', email);
    await page.fill('[data-testid="login-password"]', password);
    await page.click('[data-testid="login-submit"]');
    await page.waitForURL("/dashboard");
    await expect(page.getByTestId("dashboard-account")).toBeVisible();
  });

  test("login form rejects bad credentials", async ({ page }) => {
    await page.goto("/login");
    await page.fill('[data-testid="login-email"]', "nobody@test.local");
    await page.fill('[data-testid="login-password"]', "WrongPass123!");
    await page.click('[data-testid="login-submit"]');
    await expect(page.getByTestId("login-error")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});
