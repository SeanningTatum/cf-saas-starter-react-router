import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_REPORT_CONTENT_TYPE,
  BROWSER_REPORT_PATH,
  MAX_BROWSER_REPORTS_PER_PAGE,
  MAX_ERROR_MESSAGE_LENGTH,
  MAX_ERROR_NAME_LENGTH,
  MAX_ERROR_STACK_LENGTH,
  MAX_REPORT_URL_LENGTH,
} from "@/lib/constants/error-reporting";
import type { BrowserErrorPayload } from "@/lib/error-reporting/browser-payload";
import {
  makeBrowserReporter,
  sendBrowserReport,
  shouldReportBoundaryError,
  toBrowserPayload,
} from "@/lib/error-reporting/browser";

const page = { url: "https://app.example.com/dashboard" };

const makeReporter = () => {
  const sent: Array<BrowserErrorPayload> = [];
  const reporter = makeBrowserReporter({
    send: (payload) => sent.push(payload),
    page: () => page,
  });
  return { sent, reporter };
};

const distinctError = (index: number) => new Error(`failure ${index}`);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("toBrowserPayload", () => {
  it("keeps the name, message and stack of an Error so that the report can be read", () => {
    const error = new TypeError("cannot read x");
    const payload = toBrowserPayload(error, "window", page);
    expect(payload).toMatchObject({
      source: "window",
      name: "TypeError",
      message: "cannot read x",
      stack: error.stack,
      url: page.url,
    });
  });

  it("gives a string reason a message so that a rejected string is not blank", () => {
    const payload = toBrowserPayload("plain failure", "rejection", page);
    expect(payload.message).toBe("plain failure");
    expect(payload.stack).toBeUndefined();
  });

  it("gives an object with no message a non-empty message so that the server accepts it", () => {
    const fromObject = toBrowserPayload({ code: 7 }, "rejection", page);
    const fromNothing = toBrowserPayload(undefined, "rejection", page);
    expect(fromObject.message.length).toBeGreaterThan(0);
    expect(fromNothing.message.length).toBeGreaterThan(0);
    expect(fromNothing.name.length).toBeGreaterThan(0);
  });

  it("clips every long field to its cap so that the server does not refuse the body", () => {
    const error = new Error("m".repeat(MAX_ERROR_MESSAGE_LENGTH * 2));
    error.name = "n".repeat(MAX_ERROR_NAME_LENGTH * 2);
    error.stack = "s".repeat(MAX_ERROR_STACK_LENGTH * 2);
    const payload = toBrowserPayload(error, "window", {
      url: `https://app.example.com/${"p".repeat(MAX_REPORT_URL_LENGTH * 2)}`,
    });
    expect(payload.message).toHaveLength(MAX_ERROR_MESSAGE_LENGTH);
    expect(payload.name).toHaveLength(MAX_ERROR_NAME_LENGTH);
    expect(payload.stack).toHaveLength(MAX_ERROR_STACK_LENGTH);
    expect(payload.url).toHaveLength(MAX_REPORT_URL_LENGTH);
  });

  it("drops the query string and the hash so that a token in the address never leaves the page", () => {
    const payload = toBrowserPayload(new Error("x"), "window", {
      url: "https://app.example.com/reset?token=abc123#section",
    });
    expect(payload.url).toBe("https://app.example.com/reset");
  });

  it("drops a request id that breaks the pattern so that the server does not refuse the body", () => {
    const bad = toBrowserPayload(new Error("x"), "window", {
      url: page.url,
      requestId: "not valid!",
    });
    const good = toBrowserPayload(new Error("x"), "window", {
      url: page.url,
      requestId: "req-123",
    });
    expect(bad.requestId).toBeUndefined();
    expect(good.requestId).toBe("req-123");
  });
});

describe("makeBrowserReporter", () => {
  it("sends one payload for a new error so that a failure reaches the server", () => {
    const { sent, reporter } = makeReporter();
    reporter.report(new Error("boom"), "boundary");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.source).toBe("boundary");
  });

  it("sends the same error object once so that the window listener and the boundary do not double count", () => {
    const { sent, reporter } = makeReporter();
    const error = new Error("boom");
    reporter.report(error, "window");
    reporter.report(error, "boundary");
    expect(sent).toHaveLength(1);
  });

  it("sends one report for two objects with the same fingerprint so that a loop does not repeat itself", () => {
    const { sent, reporter } = makeReporter();
    const first = new Error("same");
    const second = new Error("same");
    second.stack = first.stack;
    reporter.report(first, "window");
    reporter.report(second, "window");
    expect(sent).toHaveLength(1);
  });

  it("stops after the page cap so that an error in a loop cannot flood the endpoint", () => {
    const { sent, reporter } = makeReporter();
    for (let index = 0; index <= MAX_BROWSER_REPORTS_PER_PAGE; index += 1) {
      reporter.report(distinctError(index), "window");
    }
    expect(sent).toHaveLength(MAX_BROWSER_REPORTS_PER_PAGE);
  });

  it("does not count a repeat against the cap so that one noisy error cannot hide new ones", () => {
    const { sent, reporter } = makeReporter();
    const repeated = new Error("repeat");
    for (let index = 0; index < MAX_BROWSER_REPORTS_PER_PAGE; index += 1) {
      reporter.report(repeated, "window");
    }
    reporter.report(new Error("fresh"), "window");
    expect(sent).toHaveLength(2);
  });

  it("does not throw on undefined so that reporting never adds a second error", () => {
    const { reporter } = makeReporter();
    expect(() => reporter.report(undefined, "rejection")).not.toThrow();
  });

  it("does not throw on an object with a throwing getter so that a hostile value cannot loop", () => {
    const { sent, reporter } = makeReporter();
    const hostile = {
      get message(): string {
        return expect.unreachable("the getter must not run");
      },
    };
    expect(() => reporter.report(hostile, "rejection")).not.toThrow();
    expect(sent).toHaveLength(1);
  });
});

interface FakeTarget {
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  listeners: Map<string, Array<(event: Event) => void>>;
}

const makeFakeTarget = (): FakeTarget => {
  const listeners = new Map<string, Array<(event: Event) => void>>();
  return {
    listeners,
    addEventListener: (type, listener) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
  };
};

const stubBrowser = () => {
  const fetchMock = vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(null)),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { href: "https://app.example.com/a?x=1#y" });
  vi.stubGlobal("document", {
    documentElement: { dataset: { requestId: "req-42" } },
  });
  return fetchMock;
};

const firstBody = (fetchMock: ReturnType<typeof stubBrowser>) =>
  JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}"));

describe("installBrowserErrorReporting", () => {
  it("posts an error event with source window so that uncaught errors are captured", async () => {
    const fetchMock = stubBrowser();
    const { installBrowserErrorReporting } = await import(
      "@/lib/error-reporting/browser"
    );
    const target = makeFakeTarget();
    installBrowserErrorReporting(target);
    const [onError] = target.listeners.get("error") ?? [];
    onError?.({ error: new Error("uncaught") } as unknown as Event);
    expect(firstBody(fetchMock)).toMatchObject({
      source: "window",
      message: "uncaught",
      url: "https://app.example.com/a",
      requestId: "req-42",
    });
  });

  it("falls back to the event message so that a cross-origin script error is not lost", async () => {
    const fetchMock = stubBrowser();
    const { installBrowserErrorReporting } = await import(
      "@/lib/error-reporting/browser"
    );
    const target = makeFakeTarget();
    installBrowserErrorReporting(target);
    const [onError] = target.listeners.get("error") ?? [];
    onError?.({ error: null, message: "Script error." } as unknown as Event);
    expect(firstBody(fetchMock).message).toBe("Script error.");
  });

  it("posts an unhandledrejection with source rejection so that lost promises are captured", async () => {
    const fetchMock = stubBrowser();
    const { installBrowserErrorReporting } = await import(
      "@/lib/error-reporting/browser"
    );
    const target = makeFakeTarget();
    installBrowserErrorReporting(target);
    const [onRejection] = target.listeners.get("unhandledrejection") ?? [];
    onRejection?.({ reason: new Error("rejected") } as unknown as Event);
    expect(firstBody(fetchMock)).toMatchObject({
      source: "rejection",
      message: "rejected",
    });
  });

  it("adds no listeners on a second install so that one error is not reported twice", async () => {
    stubBrowser();
    const { installBrowserErrorReporting } = await import(
      "@/lib/error-reporting/browser"
    );
    const target = makeFakeTarget();
    installBrowserErrorReporting(target);
    installBrowserErrorReporting(target);
    expect(target.listeners.get("error")).toHaveLength(1);
    expect(target.listeners.get("unhandledrejection")).toHaveLength(1);
  });

  it("posts to the same-origin path as keepalive JSON so that the report survives a page exit", async () => {
    const fetchMock = stubBrowser();
    const { installBrowserErrorReporting } = await import(
      "@/lib/error-reporting/browser"
    );
    const target = makeFakeTarget();
    installBrowserErrorReporting(target);
    const [onError] = target.listeners.get("error") ?? [];
    onError?.({ error: new Error("x") } as unknown as Event);
    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe(BROWSER_REPORT_PATH);
    expect(init).toMatchObject({
      method: "POST",
      keepalive: true,
      headers: { "content-type": BROWSER_REPORT_CONTENT_TYPE },
    });
  });
});

describe("sendBrowserReport", () => {
  it("swallows a failed fetch so that a lost report cannot raise another error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    const unhandled: Array<unknown> = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", record);
    sendBrowserReport({
      source: "window",
      name: "Error",
      message: "x",
      url: page.url,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    process.off("unhandledRejection", record);
    expect(unhandled).toEqual([]);
  });
});

describe("shouldReportBoundaryError", () => {
  it("skips the error the server rendered so that one failure is not reported twice", () => {
    const rendered = new Error("server");
    expect(shouldReportBoundaryError(rendered, rendered)).toBe(false);
  });

  it("skips a 404 response so that a missing page is not counted as a defect", () => {
    expect(
      shouldReportBoundaryError(
        { status: 404, statusText: "Not Found", data: null },
        undefined,
      ),
    ).toBe(false);
  });

  it("reports a 500 response so that a server failure on navigation is seen", () => {
    expect(
      shouldReportBoundaryError(
        { status: 500, statusText: "Server Error", data: null },
        undefined,
      ),
    ).toBe(true);
  });

  it("reports a new Error so that a client render failure is seen", () => {
    expect(
      shouldReportBoundaryError(new Error("client"), new Error("server")),
    ).toBe(true);
  });
});

describe("toBrowserPayload, route error responses", () => {
  it("names a failed navigation by its status, so a 500 on a client navigation is not filed as Unknown error", () => {
    const payload = toBrowserPayload(
      { status: 500, statusText: "Internal Server Error", data: "x" },
      "boundary",
      page
    );

    expect(payload.name).toBe("RouteErrorResponse");
    expect(payload.message).toBe("500 Internal Server Error");
  });
});
