import { test, expect } from "@playwright/test";
import authText from "@/locales/en/auth.json" with { type: "json" };
import {
  HTTP_TOO_MANY_REQUESTS,
  RATE_LIMITED_CODE,
  RETRY_AFTER_HEADER,
} from "../app/lib/constants/rate-limit";
import { postSignIn } from "./lib/auth-api";
import { fillLogin, isSignInPost, waitForAuthFormReady } from "./lib/auth-form";
import { appOrigin, freshDocumentationIpv6, sendClientIpOnAppApiRequests } from "./lib/client-ip";
import { rateLimitFromWrangler, startEarlyInAFixedWindow } from "./lib/rate-limits";
import {
  CLIENT_IPS,
  HTTP_STATUS,
  PAGE_PATHS,
  RATE_LIMIT_WINDOW_MARGIN_SECONDS,
  SEEDED_LOGINS,
  SEEDED_PASSWORD,
} from "./lib/values";

test.describe("Sign-in rate limit", () => {
  test("sign-in limit: past the wrangler.jsonc limit the form says wait a minute and stays on /login, while another client IP still signs in", {
    tag: "@error",
  }, async ({ page, context, browser, baseURL }) => {
    test.slow();
    const origin = appOrigin(baseURL);
    const rule = rateLimitFromWrangler("signIn");
    expect(rule.limit, "wrangler.jsonc sets no sign-in limit").toBeGreaterThan(0);
    const guesser = { origin, clientIp: freshDocumentationIpv6() };
    const wrongPassword = { email: SEEDED_LOGINS.user, password: `wrong-${crypto.randomUUID()}` };

    await sendClientIpOnAppApiRequests(context, origin, guesser.clientIp);
    await page.goto(PAGE_PATHS.login);
    await waitForAuthFormReady(page, "login");
    await fillLogin(page, wrongPassword.email, wrongPassword.password);

    await startEarlyInAFixedWindow(rule, RATE_LIMIT_WINDOW_MARGIN_SECONDS);
    for (let attempt = 1; attempt <= rule.limit; attempt += 1) {
      const res = await postSignIn(page.request, guesser, wrongPassword);
      expect(res.status(), `sign-in ${attempt} of ${rule.limit} was limited too early`).toBe(
        HTTP_STATUS.unauthorized,
      );
    }

    const refused = page.waitForResponse((response) => isSignInPost(response.request()));
    await page.getByTestId("login-submit").click();
    const response = await refused;
    expect(response.status(), `sign-in ${rule.limit + 1} was not limited`).toBe(
      HTTP_TOO_MANY_REQUESTS,
    );
    expect(response.headers()[RETRY_AFTER_HEADER.toLowerCase()]).toBe(String(rule.periodSeconds));
    expect(await response.json()).toMatchObject({ code: RATE_LIMITED_CODE });
    await expect(page.getByTestId("login-error")).toHaveText(authText.refusal.rate_limited);
    await expect(page).toHaveURL(/\/login$/);

    const otherContext = await browser.newContext({ baseURL });
    await sendClientIpOnAppApiRequests(otherContext, origin, CLIENT_IPS["auth-rate-limit"]);
    const otherPage = await otherContext.newPage();
    await otherPage.goto(PAGE_PATHS.login);
    await waitForAuthFormReady(otherPage, "login");
    await fillLogin(otherPage, SEEDED_LOGINS.user, SEEDED_PASSWORD);
    await otherPage.getByTestId("login-submit").click();
    await otherPage.waitForURL(PAGE_PATHS.dashboard);
    await expect(otherPage.getByTestId("dashboard-account")).toBeVisible();
    await otherContext.close();
  });
});
