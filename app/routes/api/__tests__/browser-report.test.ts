import { Effect, ManagedRuntime } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_REPORT_PATH,
  BROWSER_REPORT_RETRY_AFTER_SECONDS,
  BROWSER_REPORT_WINDOW_LIMIT,
  MAX_REPORT_BODY_BYTES,
} from "@/lib/constants/error-reporting";
import type { ErrorCapture } from "@/lib/error-reporting/report";
import type { ErrorReporterShape } from "@/services/error-reporter";

const endpoint = `https://app.example.com${BROWSER_REPORT_PATH}`;

const goodReport = () => ({
  source: "boundary",
  name: "Error",
  message: "render failed",
  url: "https://app.example.com/dashboard",
  requestId: "req-abc",
});

const post = (body: string, contentType: string) =>
  new Request(endpoint, { method: "POST", body, headers: { "content-type": contentType } });

const freshRoute = async (reporter?: ErrorReporterShape) => {
  vi.resetModules();
  const route = await import("../browser-report");
  const { ErrorReporterFrom } = await import("@/services/error-reporter");
  const { loggers } = await import("@/lib/logger");
  const captures: ErrorCapture[] = [];
  const reported: ErrorCapture[] = [];
  const recording: ErrorReporterShape = {
    capture: (capture) => Effect.sync(() => void captures.push(capture)),
  };
  const runtime = ManagedRuntime.make(ErrorReporterFrom(reporter ?? recording));
  const context = { runtime, reportError: (capture: ErrorCapture) => void reported.push(capture) };
  const send = (request: Request) => route.action({ request, context });
  return { route, loggers, captures, reported, send };
};

describe("browser report route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("answers 204 and captures one report with its source, url and requestId, so that a browser error reaches the reporter", async () => {
    const { send, captures } = await freshRoute();
    const response = await send(post(JSON.stringify(goodReport()), "application/json"));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatchObject({
      source: "boundary",
      url: "https://app.example.com/dashboard",
      requestId: "req-abc",
    });
  });

  it("answers 405 to a PUT and to a GET through the loader, so that only POST can file a report", async () => {
    const { route, send, captures } = await freshRoute();
    const put = await send(new Request(endpoint, { method: "PUT", body: "{}" }));
    const get = await route.loader();
    expect([put.status, get.status]).toEqual([405, 405]);
    expect(get.headers.get("allow")).toBe("POST");
    expect(captures).toEqual([]);
  });

  it("answers 429 with retry-after once the window budget is spent and captures nothing more, so that a flood cannot reach the reporter", async () => {
    const { send, captures } = await freshRoute();
    for (let sent = 0; sent < BROWSER_REPORT_WINDOW_LIMIT; sent += 1) {
      await send(post(JSON.stringify(goodReport()), "application/json"));
    }
    const response = await send(post(JSON.stringify(goodReport()), "application/json"));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe(String(BROWSER_REPORT_RETRY_AFTER_SECONDS));
    expect(captures).toHaveLength(BROWSER_REPORT_WINDOW_LIMIT);
  });

  it("does not spend the budget on a refused body, so that junk posts cannot shut out real reports", async () => {
    const { send, captures } = await freshRoute();
    for (let sent = 0; sent < BROWSER_REPORT_WINDOW_LIMIT; sent += 1) {
      await send(post("", "text/plain"));
    }
    const response = await send(post(JSON.stringify(goodReport()), "application/json"));
    expect(response.status).toBe(204);
    expect(captures).toHaveLength(1);
  });

  it.each([
    [
      413,
      JSON.stringify({ ...goodReport(), message: "m".repeat(MAX_REPORT_BODY_BYTES) }),
      "application/json",
    ],
    [415, JSON.stringify(goodReport()), "text/plain"],
    [400, "{not json", "application/json"],
  ])(
    "passes a %i through with an empty body and no capture, so that a bad post is never reported as an error",
    async (status, body, contentType) => {
      const { send, captures } = await freshRoute();
      const response = await send(post(body, contentType));
      expect(response.status).toBe(status);
      expect(await response.text()).toBe("");
      expect(captures).toEqual([]);
    },
  );

  it("logs only the status and reason of a rejected body, so that personal data in a bad post never reaches a log line", async () => {
    const { send, loggers } = await freshRoute();
    const spies = (["trace", "debug", "info", "warn", "error", "fatal"] as const).map((level) =>
      vi.spyOn(loggers.server, level),
    );
    const marker = "user@example.com";
    await send(post(`{"message": "${marker}"`, "application/json"));
    await send(post(JSON.stringify({ ...goodReport(), source: marker }), "application/json"));
    const calls = spies.flatMap((spy) => spy.mock.calls);
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls)).not.toContain(marker);
    expect(calls[0]?.[0]).toEqual({ status: 400, reason: expect.any(String) });
  });

  it("answers 500 and hands the cause to reportError when the program dies, so that a broken reporter is still seen", async () => {
    const dying: ErrorReporterShape = { capture: () => Effect.die(new Error("reporter broke")) };
    const { send, reported } = await freshRoute(dying);
    const response = await send(post(JSON.stringify(goodReport()), "application/json"));
    expect(response.status).toBe(500);
    expect(reported).toHaveLength(1);
    expect(reported[0]?.source).toBe("action");
  });
});
