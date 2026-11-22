import { expect, type Page, type Request } from "@playwright/test";
import { hydrated } from "./hydration";
import {
  API_PATHS,
  TIMEOUTS_MS,
  TURNSTILE_PROBLEM_TEST_ID,
  TURNSTILE_RETRY_TEST_ID,
  TURNSTILE_STATE_ATTRIBUTE,
  TURNSTILE_WIDGET_TEST_ID,
} from "./values";

export type AuthForm = "login" | "signup";

const turnstileWidget = (page: Page) => page.getByTestId(TURNSTILE_WIDGET_TEST_ID);
export const turnstileProblem = (page: Page) => page.getByTestId(TURNSTILE_PROBLEM_TEST_ID);
export const turnstileRetry = (page: Page) => page.getByTestId(TURNSTILE_RETRY_TEST_ID);

export const expectTurnstileState = (page: Page, state: string, message: string) =>
  expect(turnstileWidget(page), message).toHaveAttribute(TURNSTILE_STATE_ATTRIBUTE, state, {
    timeout: TIMEOUTS_MS.turnstileReady,
  });

export const waitForAuthFormHydrated = async (page: Page, form: AuthForm) => {
  const submit = page.getByTestId(`${form}-submit`);
  if (await hydrated(submit, TIMEOUTS_MS.firstHydration)) return;
  await page.reload();
  expect(
    await hydrated(submit, TIMEOUTS_MS.hydrationAfterReload),
    `the ${form} form never hydrated, even after a reload past Vite's "Outdated Optimize Dep" 504`,
  ).toBe(true);
};

export const waitForAuthFormReady = async (page: Page, form: AuthForm) => {
  await waitForAuthFormHydrated(page, form);
  await expectTurnstileState(
    page,
    "ready",
    `the security check never became ready, so ${form}-submit stays disabled; the widget loads from challenges.cloudflare.com, so the run needs the network`,
  );
  await expect(page.getByTestId(`${form}-submit`)).toBeEnabled();
};

export const fillLogin = async (page: Page, email: string, password: string) => {
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
};

export const isSignInPost = (request: Request) =>
  request.method() === "POST" && new URL(request.url()).pathname === API_PATHS.signIn;

export const isSignUpPost = (request: Request) =>
  request.method() === "POST" && new URL(request.url()).pathname === API_PATHS.signUp;
