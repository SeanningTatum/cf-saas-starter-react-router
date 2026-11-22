import { test, expect, type Page } from "@playwright/test";
import authText from "@/locales/en/auth.json" with { type: "json" };
import { TURNSTILE_SCRIPT_URL, TURNSTILE_TOKEN_HEADER } from "../app/lib/constants/turnstile";
import { postSignIn, sessionCookiesSetBy } from "./lib/auth-api";
import {
  expectTurnstileState,
  fillLogin,
  isSignInPost,
  turnstileProblem,
  turnstileRetry,
  waitForAuthFormHydrated,
  waitForAuthFormReady,
} from "./lib/auth-form";
import { appOrigin, useClientIpPerFile } from "./lib/client-ip";
import {
  API_PATHS,
  EMPTY_TURNSTILE_TOKEN,
  HTTP_STATUS,
  JAVASCRIPT_CONTENT_TYPE,
  PAGE_PATHS,
  SEEDED_LOGINS,
  SEEDED_PASSWORD,
  TURNSTILE_MISSING_TOKEN_CODE,
  TURNSTILE_STUB_WIDGET_ID,
} from "./lib/values";

const isTurnstileScript = (url: URL) => url.href === TURNSTILE_SCRIPT_URL;

const turnstileStubThatSolvesWith = (token: string) => `
window.turnstile = (() => {
  const widgets = new Map();
  const solve = (id) => setTimeout(() => widgets.get(id)?.callback(${JSON.stringify(token)}));
  return {
    render(container, options) {
      widgets.set(${JSON.stringify(TURNSTILE_STUB_WIDGET_ID)}, options);
      solve(${JSON.stringify(TURNSTILE_STUB_WIDGET_ID)});
      return ${JSON.stringify(TURNSTILE_STUB_WIDGET_ID)};
    },
    reset(id) { solve(id); },
    remove(id) { widgets.delete(id); },
  };
})();
`;

const serveTurnstileStubSolvingWith = (page: Page, token: string) =>
  page.route(isTurnstileScript, (route) =>
    route.fulfill({ contentType: JAVASCRIPT_CONTENT_TYPE, body: turnstileStubThatSolvesWith(token) }),
  );

test.describe("Turnstile check on sign-in", () => {
  const clientIp = useClientIpPerFile("auth-turnstile");

  test(
    "Turnstile widget hands over an empty token: the server refuses it, the login form shows the security check refusal and makes no session, even with the right password",
    { tag: "@error" },
    async ({ page }) => {
      await serveTurnstileStubSolvingWith(page, EMPTY_TURNSTILE_TOKEN);
      await page.goto(PAGE_PATHS.login);
      await waitForAuthFormReady(page, "login");
      await fillLogin(page, SEEDED_LOGINS.user, SEEDED_PASSWORD);

      const signIn = page.waitForResponse((response) => isSignInPost(response.request()));
      await page.getByTestId("login-submit").click();
      const response = await signIn;
      expect(response.request().headers()[TURNSTILE_TOKEN_HEADER], "the form did not send the widget's token").toBe(
        EMPTY_TURNSTILE_TOKEN,
      );
      expect(response.status(), "the server let an empty Turnstile token through").toBe(HTTP_STATUS.badRequest);
      expect(await response.json()).toMatchObject({ code: TURNSTILE_MISSING_TOKEN_CODE });
      await expect(page.getByTestId("login-error")).toHaveText(authText.refusal.captcha_failed);
      await expect(page).toHaveURL(/\/login$/);

      await page.goto(PAGE_PATHS.dashboard);
      await expect(page).toHaveURL(/\/login$/);
    },
  );

  test("Turnstile token missing from a sign-in API call: refused with 400 and no session cookie", async ({
    request,
    baseURL,
  }) => {
    const response = await postSignIn(
      request,
      { origin: appOrigin(baseURL), clientIp, turnstileToken: null },
      { email: SEEDED_LOGINS.user, password: SEEDED_PASSWORD },
    );
    expect(response.status(), "a sign-in with no Turnstile token was not refused").toBe(HTTP_STATUS.badRequest);
    expect(await response.json()).toMatchObject({ code: TURNSTILE_MISSING_TOKEN_CODE });
    expect(sessionCookiesSetBy(response), "the refused sign-in set a session cookie").toEqual([]);

    const session = await request.get(API_PATHS.getSession);
    expect(await session.json(), "the refused sign-in left a session").toBeNull();
  });

  test(
    "Turnstile script blocked: the login form shows the problem box with a retry and keeps submit disabled, and retry recovers",
    { tag: "@error" },
    async ({ page }) => {
      await page.route(isTurnstileScript, (route) => route.abort("failed"));
      await page.goto(PAGE_PATHS.login);
      await waitForAuthFormHydrated(page, "login");

      await expectTurnstileState(page, "error", "a blocked Turnstile script did not put the widget in its error state");
      await expect(turnstileProblem(page)).toContainText(authText.turnstile.script_failed);
      await expect(turnstileRetry(page)).toBeVisible();
      await expect(page.getByTestId("login-submit")).toBeDisabled();

      await page.unroute(isTurnstileScript);
      await turnstileRetry(page).click();
      await waitForAuthFormReady(page, "login");
      await expect(turnstileProblem(page)).toHaveCount(0);
    },
  );
});
