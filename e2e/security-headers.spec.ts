import {
  test,
  expect,
  type APIResponse,
  type Locator,
  type Page,
  type Response,
} from "@playwright/test";
import { securityHeaders } from "../workers/security-headers";
import { useAdminSessionSignedInOncePerFile } from "./lib/admin-session";

/**
 * Security headers and the nonce CSP (issue #72), on the pages a user sees.
 *
 * workers/app.ts wraps every Worker response with the header set from
 * workers/security-headers.ts and puts a fresh nonce in `script-src`; the
 * server renders that nonce on each inline `<script>`. The unit tests pin the
 * header text; this spec checks the wiring in a real browser:
 *
 * - each page's document carries the whole set, compared against the module
 *   itself so the spec cannot drift from it;
 * - the nonce in the header is the nonce on every `<script>` in the raw HTML;
 * - the page loads and hydrates with no CSP violation.
 *
 * The e2e server is Vite dev, so the Worker runs with `dev: true` (no HSTS,
 * `ws:` in connect-src). Static files skip the Worker in dev; `public/_headers`
 * is pinned by workers/__tests__/security-headers.test.ts instead.
 */

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
  return match![1];
};

/** The set the Worker must send, as Playwright reports it (lower-case names). */
const expectedHeaders = (nonce: string) =>
  Object.fromEntries(
    Object.entries(securityHeaders({ nonce, dev: true })).map(([k, v]) => [k.toLowerCase(), v]),
  );

/** Every header in the set is present with the module's value. Returns the nonce. */
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

/** Every `<script>` tag in the raw HTML carries the header's nonce. */
const expectScriptsCarryNonce = (html: string, nonce: string, where: string) => {
  const tags = html.match(/<script\b[^>]*>/gi) ?? [];
  expect(tags.length, `${where}: the page rendered no <script> at all`).toBeGreaterThan(0);
  const wrong = tags.filter((tag) => /\bnonce="([^"]*)"/.exec(tag)?.[1] !== nonce);
  expect(
    wrong,
    `${where}: these <script> tags lack nonce="${nonce}"; an inline script must take its nonce from useNonce() (see ${DOC})`,
  ).toEqual([]);
};

/**
 * Records CSP violations two ways: a `securitypolicyviolation` listener (added
 * by Playwright before any page script, so the page CSP does not apply to it)
 * and Chrome's console report. The listener does not depend on Chrome's
 * wording, which has changed between versions; the console is what a
 * developer sees. Both report to the test process, so a reload does not lose them. Install
 * once per page; `checkPage` clears the lists before each load.
 */
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

/**
 * Wait until React has hydrated `ready`: React sets its `__reactProps$…` key
 * on a DOM node only when it claims the node during hydration, so the server
 * HTML alone never passes.
 */
const hydrated = (ready: Locator, timeout: number) =>
  expect
    .poll(
      () =>
        ready
          .evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactProps$")), undefined, {
            timeout: 1_000,
          })
          .catch(() => false),
      { timeout, message: "the page never hydrated" },
    )
    .toBe(true)
    .then(
      () => true,
      () => false,
    );

/**
 * Load `url` and wait for hydration. On a cold dev server the first load can
 * die on Vite's "504 Outdated Optimize Dep" and never hydrate (issue #50);
 * one reload recovers it, as in e2e/auth.spec.ts.
 */
const loadHydrated = async (page: Page, url: string, ready: (page: Page) => Locator): Promise<Response> => {
  let response = await page.goto(url);
  if (!(await hydrated(ready(page), 15_000))) {
    response = await page.reload();
    expect(await hydrated(ready(page), 30_000), `${url} never hydrated`).toBe(true);
  }
  expect(response, `${url}: no document response`).not.toBeNull();
  return response!;
};

const watchers = new WeakMap<Page, Awaited<ReturnType<typeof watchViolations>>>();

/** Headers, nonce on every script, and no violation, for one page. */
const checkPage = async (page: Page, url: string, ready: (page: Page) => Locator) => {
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
  violations.expectNone(url);
};

test.describe("Security headers, signed out", () => {
  // Catches: a page the CSP breaks (an inline script without the nonce, a
  // script host missing from script-src), or a header dropped from the set.
  test("home and login send the headers and load with no CSP violation", { tag: "@golden" }, async ({ page }) => {
    await checkPage(page, "/", (p) => p.getByTestId("topbar-sign-in"));
    await checkPage(page, "/login", (p) => p.getByTestId("login-submit"));
  });

  // Catches: a nonce made once per isolate (or hard-coded) instead of per
  // request, which an attacker could read once and reuse.
  test("each request gets a fresh nonce", async ({ request }) => {
    const first = nonceOf((await request.get("/login")).headers()["content-security-policy"]);
    const second = nonceOf((await request.get("/login")).headers()["content-security-policy"]);
    expect(first).not.toBe(second);
  });

  // Catches: headers applied only in the page renderer, leaving API routes bare.
  test("an API response carries the headers too", async ({ request }) => {
    const res: APIResponse = await request.get("/api/auth/get-session");
    expect(res.status()).toBe(200);
    expectSecurityHeaders(res.headers(), "/api/auth/get-session");
  });
});

test.describe("Security headers, signed in as admin", () => {
  // The admin can open /dashboard too.
  useAdminSessionSignedInOncePerFile("security-headers");

  const sidebarToggle = (p: Page) => p.getByRole("button", { name: "Toggle Sidebar" }).first();

  // Catches: the dashboard's scripts or theme script blocked by the CSP.
  test("dashboard sends the headers and loads with no CSP violation", async ({ page }) => {
    await checkPage(page, "/dashboard", (p) => p.getByTestId("dashboard-go-admin"));
  });

  // Catches: the admin charts or sidebar blocked by the CSP.
  test("admin sends the headers and loads with no CSP violation", async ({ page }) => {
    await checkPage(page, "/admin", sidebarToggle);
  });

  // Catches: a component in the gallery (Radix, charts, toasts, upload) that
  // needs an inline script or an outside host the CSP does not allow.
  test("kitchen sink sends the headers and loads with no CSP violation", async ({ page }) => {
    await checkPage(page, "/admin/kitchen-sink", (p) => p.getByTestId("file-upload-dropzone"));
  });
});
