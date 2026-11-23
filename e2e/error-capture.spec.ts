import { test, expect, type Page, type Request } from "@playwright/test";
import {
  BROWSER_REPORT_CONTENT_TYPE,
  BROWSER_REPORT_PATH,
  CSP_REPORT_CONTENT_TYPE,
  MAX_REPORT_BODY_BYTES,
} from "../app/lib/constants/error-reporting";
import { loadHydrated } from "./lib/hydration";

type SentReport = {
  source: string;
  name: string;
  message: string;
  stack?: string;
  url: string;
  requestId?: string;
};

const MISSING = "/no/such/page/e2e";

const isReport = (url: string) => new URL(url).pathname === BROWSER_REPORT_PATH;

const sentReport = (request: Request): SentReport =>
  JSON.parse(request.postData() ?? "null") as SentReport;

const carries = (request: Request, marker: string) =>
  isReport(request.url()) && (request.postData() ?? "").includes(marker);

const signInLink = (page: Page) => page.getByTestId("topbar-sign-in");
const notFoundHeading = (page: Page) => page.getByRole("heading", { level: 1, name: "404" });

const throwLater = (page: Page, message: string) =>
  page.evaluate((text) => {
    setTimeout(() => {
      throw new Error(text);
    }, 0);
  }, message);

const reportResponse = (page: Page, marker: string) =>
  page.waitForResponse((response) => carries(response.request(), marker));

test.describe("Browser error capture", () => {
  test("an uncaught browser error is posted to the endpoint with its source, the page's request id and a URL without the query", {
    tag: "@golden",
  }, async ({ page, baseURL }) => {
    const document = await loadHydrated(page, "/?token=e2e-fake", signInLink);
    const requestId = await page.locator("html").getAttribute("data-request-id");
    expect(requestId, "the server wrote no data-request-id on <html>").toBeTruthy();
    expect(requestId, "the document's id is not the response's x-request-id").toBe(
      (await document.allHeaders())["x-request-id"],
    );

    const marker = `e2e-window-${crypto.randomUUID()}`;
    const answered = reportResponse(page, marker);
    await throwLater(page, marker);
    const response = await answered;
    const request = response.request();

    expect(request.method()).toBe("POST");
    expect(request.headers()["content-type"]).toBe(BROWSER_REPORT_CONTENT_TYPE);
    expect(response.status(), "the endpoint did not accept the report").toBe(204);

    const body = sentReport(request);
    expect(body.source).toBe("window");
    expect(body.name).toBe("Error");
    expect(body.message).toContain(marker);
    expect(body.stack, "the stack was dropped").toContain(marker);
    expect(body.requestId, "the report lost the page's request id").toBe(requestId);
    expect(body.url, "the query string reached the report").not.toContain("?");
    expect(body.url).not.toContain("e2e-fake");
    expect(body.url).toBe(new URL("/", baseURL).href);
  });

  test("an unhandled promise rejection is posted to the endpoint with source rejection", {
    tag: "@golden",
  }, async ({ page }) => {
    await loadHydrated(page, "/", signInLink);

    const marker = `e2e-rejection-${crypto.randomUUID()}`;
    const answered = reportResponse(page, marker);
    await page.evaluate((text) => {
      void Promise.reject(new Error(text));
    }, marker);
    const response = await answered;

    expect(response.status(), "the endpoint did not accept the report").toBe(204);
    const body = sentReport(response.request());
    expect(body.source).toBe("rejection");
    expect(body.name).toBe("Error");
    expect(body.message).toContain(marker);
  });

  test("the same error thrown twice on one page is posted once, not once per throw", async ({
    page,
  }) => {
    const sent: Request[] = [];
    page.on("request", (request) => {
      if (isReport(request.url())) sent.push(request);
    });
    await loadHydrated(page, "/", signInLink);

    const repeated = `e2e-repeat-${crypto.randomUUID()}`;
    const sentinel = `e2e-sentinel-${crypto.randomUUID()}`;
    const sentinelSent = page.waitForRequest((request) => carries(request, sentinel));
    await page.evaluate(
      ({ repeatedText, sentinelText }) => {
        const fail = (text: string) => {
          throw new Error(text);
        };
        setTimeout(() => fail(repeatedText), 0);
        setTimeout(() => fail(repeatedText), 0);
        setTimeout(() => fail(sentinelText), 0);
      },
      { repeatedText: repeated, sentinelText: sentinel },
    );
    await sentinelSent;

    const repeats = sent.filter((request) => carries(request, repeated));
    expect(repeats.length, "the repeated error was not posted exactly once").toBe(1);
  });

  test("a server-rendered 404 page is not reported by the browser after hydration", async ({
    page,
  }) => {
    const sent: Request[] = [];
    page.on("request", (request) => {
      if (isReport(request.url())) sent.push(request);
    });
    const response = await loadHydrated(page, MISSING, notFoundHeading);
    expect(response.status()).toBe(404);

    const sentinel = `e2e-sentinel-${crypto.randomUUID()}`;
    const sentinelSent = page.waitForRequest((request) => carries(request, sentinel));
    await page.evaluate(
      (text) =>
        new Promise<void>((settled) => {
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              setTimeout(() => {
                settled();
                throw new Error(text);
              }, 0),
            ),
          );
        }),
      sentinel,
    );
    await sentinelSent;

    const others = sent
      .filter((request) => !carries(request, sentinel))
      .map((request) => request.postData());
    expect(others, "the browser reported the page the server already rendered").toEqual([]);
  });

  test("an error first met in the browser on a client navigation is posted with source boundary, so a failed navigation is not lost", async ({
    page,
    baseURL,
  }) => {
    const sent: Request[] = [];
    page.on("request", (request) => {
      if (isReport(request.url())) sent.push(request);
    });
    await loadHydrated(page, "/login", (page) => page.getByTestId("login-form"));
    sent.length = 0;
    await loadHydrated(page, "/", signInLink);

    const forced: string[] = [];
    await page.route(
      (url) => url.pathname === "/login.data",
      (route) => {
        forced.push(route.request().url());
        return route.fulfill({
          status: 500,
          contentType: "text/plain",
          body: "e2e forced failure",
        });
      },
    );
    const pageLoad = crypto.randomUUID();
    await page.evaluate((id) => {
      Reflect.set(window, "__e2ePageLoad", id);
    }, pageLoad);

    const answered = page.waitForResponse(
      (response) =>
        isReport(response.url()) && response.request().postData()?.includes('"boundary"') === true,
    );
    await signInLink(page).click();
    const response = await answered;

    await expect(page).toHaveURL(new URL("/login", baseURL).href);
    await expect(page.getByRole("heading", { level: 1, name: "Error" })).toBeVisible();
    expect(forced.length, "the client navigation never fetched /login.data").toBeGreaterThan(0);
    expect(
      await page.evaluate(() => Reflect.get(window, "__e2ePageLoad")),
      "the failed navigation reloaded the document instead of rendering the error boundary",
    ).toBe(pageLoad);

    const requestId = await page.locator("html").getAttribute("data-request-id");
    if (requestId !== null) {
      await expect(page.getByTestId("error-request-id")).toContainText(requestId);
    }

    const request = response.request();
    expect(request.method()).toBe("POST");
    expect(response.status(), "the endpoint did not accept the report").toBe(204);
    const body = sentReport(request);
    expect(body.source).toBe("boundary");
    expect(body.requestId, "the report's request id is not the document's").toBe(
      requestId ?? undefined,
    );
    expect(body.url, "the query string reached the report").not.toContain("?");
    expect(body.url).toBe(new URL("/login", baseURL).href);

    const sentinel = `e2e-sentinel-${crypto.randomUUID()}`;
    const sentinelSent = page.waitForRequest((request) => carries(request, sentinel));
    await throwLater(page, sentinel);
    await sentinelSent;

    const others = sent
      .filter((request) => !carries(request, sentinel))
      .map((request) => sentReport(request));
    expect(others, "the failed navigation was not posted exactly once").toEqual([body]);
  });
});

test.describe("Browser report endpoint", () => {
  test("the endpoint refuses an oversized body, a wrong content type, bad JSON, an unknown source and a GET", {
    tag: "@error",
  }, async ({ request, baseURL }) => {
    const valid = {
      source: "window",
      name: "Error",
      message: "e2e endpoint check",
      url: new URL("/", baseURL).href,
    };

    const oversized = await request.post(BROWSER_REPORT_PATH, {
      headers: { "content-type": BROWSER_REPORT_CONTENT_TYPE },
      data: JSON.stringify({ ...valid, message: "x".repeat(MAX_REPORT_BODY_BYTES) }),
    });
    expect(oversized.status(), "a body over the byte cap was not refused").toBe(413);

    const plainText = await request.post(BROWSER_REPORT_PATH, {
      headers: { "content-type": "text/plain" },
      data: JSON.stringify(valid),
    });
    expect(plainText.status(), "a text/plain body was not refused").toBe(415);

    const notJson = await request.post(BROWSER_REPORT_PATH, {
      headers: { "content-type": BROWSER_REPORT_CONTENT_TYPE },
      data: Buffer.from("{not json"),
    });
    expect(notJson.status(), "a body that is not JSON was not refused").toBe(400);

    const unknownSource = await request.post(BROWSER_REPORT_PATH, {
      headers: { "content-type": BROWSER_REPORT_CONTENT_TYPE },
      data: JSON.stringify({ ...valid, source: "e2e-unknown" }),
    });
    expect(unknownSource.status(), "a report with an unknown source was not refused").toBe(400);

    const get = await request.get(BROWSER_REPORT_PATH);
    expect(get.status(), "a GET was not refused").toBe(405);
    expect(get.headers().allow).toBe("POST");
  });

  test("a legacy CSP violation report is accepted, not refused as a bad body", async ({
    request,
  }) => {
    const response = await request.post(BROWSER_REPORT_PATH, {
      headers: { "content-type": CSP_REPORT_CONTENT_TYPE },
      data: JSON.stringify({
        "csp-report": {
          "document-uri": "http://localhost/",
          "effective-directive": "script-src-elem",
          "blocked-uri": "https://evil.example/x.js?secret=1",
        },
      }),
    });
    expect(response.status()).toBe(204);
  });
});
