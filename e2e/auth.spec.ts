import { test, expect, type Page } from "@playwright/test";
import { TURNSTILE_TEST_TOKEN, TURNSTILE_TOKEN_HEADER } from "../app/lib/constants/turnstile";
import {
  fillLogin,
  isSignInPost,
  isSignUpPost,
  waitForAuthFormReady,
} from "./lib/auth-form";
import { useClientIpPerFile } from "./lib/client-ip";
import { API_PATHS, HTTP_STATUS, PAGE_PATHS, SEEDED_LOGINS, SEEDED_PASSWORD } from "./lib/values";

const holdScriptsUntilReleased = async (page: Page) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() === "script") await gate;
    await route.fallback();
  });
  return release;
};

const signOutFromThePage = (page: Page) =>
  page.evaluate(
    (path) =>
      fetch(path, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).then((r) => r.status),
    API_PATHS.signOut,
  );

test.describe("Authentication", () => {
  useClientIpPerFile("auth");

  test(
    "sign-up → dashboard, sign-out → login, sign-in → dashboard, each form sending the Turnstile token",
    { tag: "@golden" },
    async ({ page }) => {
      const runId = crypto.randomUUID();
      const email = `e2e-${runId}@test.local`;
      const password = `E2E-${runId}`;

      await page.goto(PAGE_PATHS.signUp);
      await waitForAuthFormReady(page, "signup");
      await page.getByTestId("signup-name").fill("E2E User");
      await page.getByTestId("signup-email").fill(email);
      await page.getByTestId("signup-password").fill(password);
      await page.getByTestId("signup-confirm-password").fill(password);
      const signUp = page.waitForRequest(isSignUpPost);
      await page.getByTestId("signup-submit").click();
      expect((await signUp).headers()[TURNSTILE_TOKEN_HEADER], "sign-up sent no Turnstile token").toBe(
        TURNSTILE_TEST_TOKEN,
      );
      await page.waitForURL(PAGE_PATHS.dashboard);
      await expect(page.getByTestId("dashboard-account")).toBeVisible();

      expect(await signOutFromThePage(page)).toBe(HTTP_STATUS.ok);
      await page.goto(PAGE_PATHS.dashboard);
      await page.waitForURL(PAGE_PATHS.login);

      await waitForAuthFormReady(page, "login");
      await fillLogin(page, email, password);
      const signIn = page.waitForRequest(isSignInPost);
      await page.getByTestId("login-submit").click();
      expect((await signIn).headers()[TURNSTILE_TOKEN_HEADER], "sign-in sent no Turnstile token").toBe(
        TURNSTILE_TEST_TOKEN,
      );
      await page.waitForURL(PAGE_PATHS.dashboard);
      await expect(page.getByTestId("dashboard-account")).toBeVisible();
    },
  );

  test("login form shows an error and stays on /login for bad credentials", { tag: "@error" }, async ({ page }) => {
    await page.goto(PAGE_PATHS.login);
    await waitForAuthFormReady(page, "login");
    await fillLogin(page, `nobody-${crypto.randomUUID()}@test.local`, "WrongPass123!");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-error")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("Banned account", () => {
  useClientIpPerFile("auth");

  test(
    "banned account is refused at login with the ban message and gets no session (issue #69)",
    { tag: "@error" },
    async ({ page }) => {
      await page.goto(PAGE_PATHS.login);
      await waitForAuthFormReady(page, "login");
      await fillLogin(page, SEEDED_LOGINS.banned, SEEDED_PASSWORD);
      await page.getByTestId("login-submit").click();

      await expect(page.getByRole("alert")).toContainText(/banned/i);
      await expect(page).toHaveURL(/\/login$/);

      await page.goto(PAGE_PATHS.dashboard);
      await expect(page).toHaveURL(/\/login$/);
    },
  );
});

test.describe("Auth forms before hydration", () => {
  useClientIpPerFile("auth");

  const forms = [
    { path: PAGE_PATHS.signUp, form: "signup", passwordFields: ["signup-password", "signup-confirm-password"] },
    { path: PAGE_PATHS.login, form: "login", passwordFields: ["login-password"] },
  ] as const;

  for (const { path, form, passwordFields } of forms) {
    test(`${path} ignores a submit before hydration and keeps the password out of the URL (issue #49)`, async ({
      page,
    }) => {
      const release = await holdScriptsUntilReleased(page);
      await page.goto(path, { waitUntil: "commit" });

      const formLocator = page.getByTestId(`${form}-form`);
      const submit = page.getByTestId(`${form}-submit`);
      await expect(formLocator).toBeVisible();
      await expect(formLocator).toHaveAttribute("method", "post");
      await expect(submit).toBeDisabled();

      await page.getByTestId(`${form}-email`).fill("early@test.local");
      for (const field of passwordFields) await page.getByTestId(field).fill("EarlyPass123!");
      await submit.click({ force: true });
      await page.getByTestId(passwordFields[0]).press("Enter");

      expect(new URL(page.url()).search).toBe("");
      expect(page.url()).not.toContain("EarlyPass123");

      release();
      await waitForAuthFormReady(page, form);
      expect(new URL(page.url()).pathname).toBe(path);
    });
  }
});
