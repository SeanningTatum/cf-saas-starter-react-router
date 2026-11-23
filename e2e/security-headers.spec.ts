import { test, expect, type APIResponse, type Locator, type Page } from "@playwright/test";
import { securityHeaders } from "../workers/security-headers";
import { useSavedSession } from "./lib/saved-session";
import { loadHydrated } from "./lib/hydration";
import { expectTurnstileState } from "./lib/auth-form";
import { useClientIpPerFile } from "./lib/client-ip";

const DOC = "docs/security-headers.md";

type Violation = { directive: string; blocked: string; sample: string };

declare global {
  interface Window {
    __reportCspViolation?: (v: Violation) => void;
  }
}

const nonceOf = (csp: string | undefined): string => {
  const match = /'nonce-([^']+)'/.exec(csp ?? "");
  expect(match, `no 'nonce-…' in the CSP: ${csp}`).not.toBeNull();
  return match?.[1] ?? "";
};

const expectedHeaders = (nonce: string) =>
  Object.fromEntries(
    Object.entries(securityHeaders({ nonce, dev: true })).map(([k, v]) => [k.toLowerCase(), v]),
  );

const expectSecurityHeaders = (headers: Record<string, string>, where: string): string => {
  const csp = headers["content-security-policy"];
  expect(csp, `${where}: no Content-Security-Policy header`).toBeTruthy();
  expect(csp, `${where}: framing is not refused`).toContain("frame-ancestors 'none'");
  const nonce = nonceOf(csp);
  const expected = expectedHeaders(nonce);
  const actual = Object.fromEntries(Object.keys(expected).map((k) => [k, headers[k]]));
  expect(actual, `${where}: headers differ from workers/security-headers.ts`).toEqual(expected);
  return nonce;
};

const expectScriptsCarryNonce = (html: string, nonce: string, where: string) => {
  const tags = html.match(/<script\b[^>]*>/gi) ?? [];
  expect(tags.length, `${where}: the page rendered no <script> at all`).toBeGreaterThan(0);
  const wrong = tags.filter((tag) => /\bnonce="([^"]*)"/.exec(tag)?.[1] !== nonce);
  expect(
    wrong,
    `${where}: these <script> tags lack nonce="${nonce}"; an inline script must take its nonce from useNonce() (see ${DOC})`,
  ).toEqual([]);
};

const watchViolations = async (page: Page) => {
  const events: Violation[] = [];
  const consoleReports: string[] = [];
  page.on("console", (msg) => {
    if (/Content Security Policy/i.test(msg.text())) consoleReports.push(msg.text());
  });
  await page.exposeFunction("__reportCspViolation", (v: Violation) => {
    events.push(v);
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__reportCspViolation?.({
        directive: e.violatedDirective,
        blocked: e.blockedURI,
        sample: e.sample,
      });
    });
  });
  return {
    clear() {
      events.length = 0;
      consoleReports.length = 0;
    },
    expectNone(where: string) {
      expect(
        { events, consoleReports },
        `${where}: CSP violations while loading. Fix the page or allow the host per ${DOC}`,
      ).toEqual({ events: [], consoleReports: [] });
    },
  };
};

const watchers = new WeakMap<Page, Awaited<ReturnType<typeof watchViolations>>>();

const checkPage = async (
  page: Page,
  url: string,
  ready: (page: Page) => Locator,
  settled: (page: Page) => Promise<void> = async () => {},
) => {
  let violations = watchers.get(page);
  if (!violations) {
    violations = await watchViolations(page);
    watchers.set(page, violations);
  }
  violations.clear();
  const response = await loadHydrated(page, url, ready);
  expect(new URL(page.url()).pathname, `${url} redirected; is the fixture signed in?`).toBe(url);
  expect(response.status()).toBe(200);
  const nonce = expectSecurityHeaders(await response.allHeaders(), url);
  expectScriptsCarryNonce(await response.text(), nonce, url);
  await settled(page);
  violations.expectNone(url);
};

const turnstileReadyUnderTheCsp = (page: Page) =>
  expectTurnstileState(
    page,
    "ready",
    `/login: the Turnstile widget never became ready; check script-src and frame-src allow it per ${DOC}`,
  );

test.describe("Security headers, signed out (nonce CSP, issue #72; see docs/features/security-headers-e2e.md)", () => {
  useClientIpPerFile("security-headers");

  test("home and login send the headers, and the login page's Turnstile widget reaches ready with no CSP violation", {
    tag: "@golden",
  }, async ({ page }) => {
    await checkPage(page, "/", (p) => p.getByTestId("topbar-sign-in"));
    await checkPage(
      page,
      "/login",
      (p) => p.getByTestId("login-submit"),
      turnstileReadyUnderTheCsp,
    );
  });

  test("each request gets a fresh nonce, so a nonce made once per isolate or hard-coded cannot be read once by an attacker and reused", async ({
    request,
  }) => {
    const first = nonceOf((await request.get("/login")).headers()["content-security-policy"]);
    const second = nonceOf((await request.get("/login")).headers()["content-security-policy"]);
    expect(first).not.toBe(second);
  });

  test("an API response carries the headers too, so they are not applied only in the page renderer, leaving API routes bare", async ({
    request,
  }) => {
    const res: APIResponse = await request.get("/api/auth/get-session");
    expect(res.status()).toBe(200);
    expectSecurityHeaders(res.headers(), "/api/auth/get-session");
  });
});

test.describe("Security headers, signed in as admin", () => {
  useSavedSession("admin", "security-headers");

  const sidebarToggle = (p: Page) => p.getByRole("button", { name: "Toggle Sidebar" }).first();

  test("dashboard sends the headers and loads with no CSP violation, so the CSP blocks neither its scripts nor the theme script", async ({
    page,
  }) => {
    await checkPage(page, "/dashboard", (p) => p.getByTestId("dashboard-go-admin"));
  });

  test("admin sends the headers and loads with no CSP violation, so the CSP blocks neither the admin charts nor the sidebar", async ({
    page,
  }) => {
    await checkPage(page, "/admin", sidebarToggle);
  });

  test("kitchen sink sends the headers and loads with no CSP violation, so no gallery component (Radix, charts, toasts, upload) needs an inline script or an outside host the CSP does not allow", async ({
    page,
  }) => {
    await checkPage(page, "/admin/kitchen-sink", (p) => p.getByTestId("file-upload-dropzone"));
  });
});
