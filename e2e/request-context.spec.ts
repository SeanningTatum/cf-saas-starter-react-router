import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * Request context (issue #74), seen from outside the Worker.
 *
 * workers/app.ts makes one id per request (app/lib/request-context.ts): the
 * trace id of a valid incoming `traceparent`, else a well-formed `cf-ray`,
 * else 16 random bytes as hex. Every Worker response sends it as
 * `x-request-id`, and the root ErrorBoundary in app/root.tsx shows it so a
 * user can quote it in a bug report. This spec pins:
 *
 * - every response carries the header, pages and API routes alike, and each
 *   request gets its own id;
 * - a valid `traceparent` is continued and a malformed one is ignored;
 * - the error page shows the same id the response sent, before and after
 *   hydration.
 *
 * Log lines and spans carry the id too; the unit tests pin those, since this
 * spec cannot read the server's logs. Static files skip the Worker in Vite
 * dev and carry no id, so they are not checked here.
 */

const HEADER = "x-request-id";

/** `n` random bytes as lower-case hex: a fresh trace or span id per run. */
const hex = (n: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

const idOf = (headers: Record<string, string>, where: string): string => {
  const id = headers[HEADER];
  expect(id, `${where}: no ${HEADER} header`).toBeTruthy();
  return id;
};

/**
 * Wait until React has hydrated `node`: React sets its `__reactProps$…` key
 * on a DOM node only when it claims the node during hydration, so the server
 * HTML alone never passes. Copied from e2e/security-headers.spec.ts.
 */
const hydrated = (node: Locator, timeout: number) =>
  expect
    .poll(
      () =>
        node
          .evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps$")), undefined, {
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

test.describe("Request id", () => {
  // Catches: the header set only by the page renderer (API routes bare), or an
  // id made once per isolate and shared by every request.
  test("a page and an API response each carry their own x-request-id", { tag: "@golden" }, async ({ request }) => {
    const page = await request.get("/");
    expect(page.status()).toBe(200);
    const pageId = idOf(page.headers(), "GET /");

    const api = await request.get("/api/auth/get-session");
    expect(api.status()).toBe(200);
    const apiId = idOf(api.headers(), "GET /api/auth/get-session");

    const again = idOf((await request.get("/")).headers(), "second GET /");
    expect(new Set([pageId, apiId, again]).size, "two requests shared one id").toBe(3);
  });

  // Catches: an incoming trace not continued (the id no longer joins the
  // caller's trace), or unchecked header text trusted as the id, which would
  // let any caller write what they like into logs and a response header.
  test("a valid traceparent is continued and a malformed one is ignored", async ({ request }) => {
    const traceId = hex(16);
    const spanId = hex(8);
    const valid = await request.get("/", { headers: { traceparent: `00-${traceId}-${spanId}-01` } });
    expect(idOf(valid.headers(), "valid traceparent"), "the trace id did not become the request id").toBe(traceId);

    // One malformed header is enough here; the unit test walks every shape.
    const bad = hex(16);
    const malformed = await request.get("/", { headers: { traceparent: `00-${bad}-${spanId}-01 injected` } });
    const id = idOf(malformed.headers(), "malformed traceparent");
    expect(id, "the malformed trace id came back").not.toBe(bad);
    expect(id, "the id is not a well-formed id").toMatch(/^[A-Za-z0-9-]{1,64}$/);
  });
});

test.describe("Error page", () => {
  // `/:lng` matches any single segment, so a 404 needs several.
  const MISSING = "/no/such/page/here";

  const loadErrorPage = async (page: Page) => {
    const response = await page.goto(MISSING);
    expect(response, `${MISSING}: no document response`).not.toBeNull();
    return response!;
  };

  // Catches: the error page without the id a user needs to report the fault,
  // an id that differs from the one the response (and its logs) carry, or one
  // that vanishes or changes when React hydrates the server HTML.
  test("a 404 page shows the request id of its own response", { tag: "@error" }, async ({ page }) => {
    let response = await loadErrorPage(page);
    // Wait on the heading, which renders with or without an id, so a missing
    // id line fails below on its own assertion rather than as "never hydrated".
    const heading = page.getByRole("heading", { level: 1, name: "404" });
    // On a cold dev server the first load can die on Vite's "504 Outdated
    // Optimize Dep" and never hydrate (issue #50); one reload recovers it.
    if (!(await hydrated(heading, 15_000))) {
      response = await loadErrorPage(page);
      expect(await hydrated(heading, 30_000), `${MISSING} never hydrated`).toBe(true);
    }

    expect(response.status()).toBe(404);
    const id = idOf(await response.allHeaders(), MISSING);

    // The hydrated page shows the response's id.
    const line = page.getByTestId("error-request-id");
    await expect(line, "the error page shows no request id").toBeVisible();
    await expect(line).toHaveText(`Request ID: ${id}`);
    // And the server HTML had the same id, so hydration kept it, not made it.
    expect(await response.text(), "the server HTML lacks the id").toContain(`Request ID: ${id}`);
  });
});
