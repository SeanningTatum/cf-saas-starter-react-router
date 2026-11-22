import { test, expect, type Locator, type Page } from "@playwright/test";

const HEADER = "x-request-id";

const randomHex = (n: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

const idOf = (headers: Record<string, string>, where: string): string => {
  const id = headers[HEADER];
  expect(id, `${where}: no ${HEADER} header`).toBeTruthy();
  return id;
};

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

test.describe("Request id (issue #74, seen from outside the Worker; see docs/features/request-context.md)", () => {
  test("a page and an API response each carry their own x-request-id, so the header is not page-only and no id is shared across requests", { tag: "@golden" }, async ({ request }) => {
    const page = await request.get("/");
    expect(page.status()).toBe(200);
    const pageId = idOf(page.headers(), "GET /");

    const api = await request.get("/api/auth/get-session");
    expect(api.status()).toBe(200);
    const apiId = idOf(api.headers(), "GET /api/auth/get-session");

    const again = idOf((await request.get("/")).headers(), "second GET /");
    expect(new Set([pageId, apiId, again]).size, "two requests shared one id").toBe(3);
  });

  test("a valid traceparent is continued and a malformed one is ignored (one malformed header here, the unit test walks every shape), so the id joins the caller's trace and unchecked header text cannot put what it likes into logs and a response header", async ({ request }) => {
    const traceId = randomHex(16);
    const spanId = randomHex(8);
    const valid = await request.get("/", { headers: { traceparent: `00-${traceId}-${spanId}-01` } });
    expect(idOf(valid.headers(), "valid traceparent"), "the trace id did not become the request id").toBe(traceId);

    const bad = randomHex(16);
    const malformed = await request.get("/", { headers: { traceparent: `00-${bad}-${spanId}-01 injected` } });
    const id = idOf(malformed.headers(), "malformed traceparent");
    expect(id, "the malformed trace id came back").not.toBe(bad);
    expect(id, "the id is not a well-formed id").toMatch(/^[A-Za-z0-9-]{1,64}$/);
  });
});

test.describe("Error page (/:lng matches any single segment, so the missing page needs several)", () => {
  const MISSING = "/no/such/page/here";

  const loadErrorPage = async (page: Page) => {
    const response = await page.goto(MISSING);
    expect(response, `${MISSING}: no document response`).not.toBeNull();
    return response!;
  };

  test("a 404 page shows the request id of its own response, so the error page always has the id a user needs, equal to the response's and kept through hydration", { tag: "@error" }, async ({ page }) => {
    let response = await loadErrorPage(page);
    const heading = page.getByRole("heading", { level: 1, name: "404" });
    await test.step("wait on the heading, which renders with or without an id; a cold dev server can die on Vite 504 Outdated Optimize Dep and never hydrate (issue #50), so one reload recovers it", async () => {
      if (!(await hydrated(heading, 15_000))) {
        response = await loadErrorPage(page);
        expect(await hydrated(heading, 30_000), `${MISSING} never hydrated`).toBe(true);
      }
    });

    expect(response.status()).toBe(404);
    const id = idOf(await response.allHeaders(), MISSING);

    const line = page.getByTestId("error-request-id");
    await expect(line, "the error page shows no request id").toBeVisible();
    await expect(line).toHaveText(`Request ID: ${id}`);
    expect(await response.text(), "the server HTML lacks the id").toContain(`Request ID: ${id}`);
  });
});
