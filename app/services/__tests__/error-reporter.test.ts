import { afterEach, describe, expect, it as itVitest, vi } from "vitest";
import { it } from "@effect/vitest";
import { Effect, ManagedRuntime, TestClock } from "effect";
import {
  ErrorReporter,
  ErrorReporterFrom,
  makeErrorReporter,
  readEnvironment,
  readRelease,
  reportError,
  selectErrorAdapter,
  type ErrorReporterShape,
} from "../error-reporter";
import { consoleAdapter } from "@/lib/error-reporting/adapters/console";
import { makeReportBudget } from "@/lib/error-reporting/report-budget";
import { noopAdapter } from "@/lib/error-reporting/adapters/noop";
import type { ErrorReport, ErrorReporterAdapter } from "@/lib/error-reporting/adapter";
import {
  DEVELOPMENT_ENVIRONMENT,
  MAX_REPORTS_PER_REQUEST,
  PRODUCTION_ENVIRONMENT,
  UNKNOWN_RELEASE,
} from "@/lib/constants/error-reporting";
import { loggers } from "@/lib/logger";
import type { RequestContext } from "@/lib/request-context";
import { ExternalServiceError } from "@/models/errors/repository";

const recording = () => {
  const reports: ErrorReport[] = [];
  const adapter: ErrorReporterAdapter = {
    name: "rec",
    send: (batch) => Effect.sync(() => void reports.push(...batch)),
  };
  return { reports, adapter };
};

const harness = (adapter: ErrorReporterAdapter, request?: RequestContext) => {
  const deliveries: Array<Promise<void>> = [];
  const reporter = makeErrorReporter({
    adapter,
    release: "v1.2.3",
    environment: "staging",
    request,
    waitUntil: (delivery) => void deliveries.push(delivery),
  });
  return { reporter, deliveries, settled: () => Promise.all(deliveries) };
};

const sampleReport = (): ErrorReport => ({
  id: "r1",
  timestamp: "2026-01-01T00:00:00.000Z",
  source: "fetch",
  kind: "defect",
  level: "error",
  name: "Error",
  message: "boom",
  release: "v1",
  environment: "test",
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("selectErrorAdapter", () => {
  itVitest("logs to the console when unset or unknown, so a missing setting never hides errors", () => {
    expect(selectErrorAdapter({})).toBe(consoleAdapter);
    expect(
      selectErrorAdapter({ ERROR_REPORTER: "bogus" as Env["ERROR_REPORTER"] })
    ).toBe(consoleAdapter);
  });

  itVitest("is silent only for none, so turning reporting off is an explicit choice", () => {
    expect(selectErrorAdapter({ ERROR_REPORTER: "none" })).toBe(noopAdapter);
  });

  itVitest("falls back to the console when sentry has no usable DSN, so a typo in the DSN does not drop every error", () => {
    expect(selectErrorAdapter({ ERROR_REPORTER: "sentry" })).toBe(consoleAdapter);
    expect(
      selectErrorAdapter({ ERROR_REPORTER: "sentry", SENTRY_DSN: "not a dsn" })
    ).toBe(consoleAdapter);
  });

  it.effect("with a DSN both logs and sends to Sentry, so the worker log keeps every error Sentry gets", () =>
    Effect.gen(function* () {
      const fetchFn = vi.fn(async () => ({ ok: true, status: 200 }));
      vi.stubGlobal("fetch", fetchFn);
      const logged = vi.spyOn(loggers.server, "error").mockImplementation(() => {});

      const adapter = selectErrorAdapter({
        ERROR_REPORTER: "sentry",
        SENTRY_DSN: "https://abc123@o0.ingest.example.com/1",
      });
      yield* adapter.send([sampleReport()]);

      expect(adapter.name).toBe("sentry");
      expect(logged).toHaveBeenCalledTimes(1);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    })
  );
});

describe("readRelease and readEnvironment", () => {
  itVitest("default to unversioned and to the build mode, so an unset var never yields an empty tag", () => {
    expect(readRelease({})).toBe(UNKNOWN_RELEASE);
    expect(readRelease({ RELEASE_VERSION: "" })).toBe(UNKNOWN_RELEASE);
    expect(readRelease({ RELEASE_VERSION: "abc1234" })).toBe("abc1234");
    expect(readEnvironment({}, true)).toBe(DEVELOPMENT_ENVIRONMENT);
    expect(readEnvironment({}, false)).toBe(PRODUCTION_ENVIRONMENT);
    expect(readEnvironment({ ENVIRONMENT: "staging" }, false)).toBe("staging");
  });
});

describe("makeErrorReporter", () => {
  it.effect("hands one delivery to waitUntil and stamps the request and the user set before capture, with the Clock's time", () =>
    Effect.gen(function* () {
      const { reports, adapter } = recording();
      const request: RequestContext = { requestId: "req-1", method: "POST", path: "/x" };
      const { reporter, deliveries, settled } = harness(adapter, request);
      request.userId = "u1";
      yield* TestClock.setTime(Date.parse("2026-03-04T05:06:07.000Z"));

      yield* reporter.capture({ error: new Error("boom"), source: "action" });
      expect(deliveries).toHaveLength(1);
      yield* Effect.promise(settled);

      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({
        requestId: "req-1",
        userId: "u1",
        method: "POST",
        path: "/x",
        source: "action",
        release: "v1.2.3",
        environment: "staging",
        timestamp: "2026-03-04T05:06:07.000Z",
      });
    })
  );

  itVitest("delivers one error object once, so the tRPC hook and handleError cannot report it twice", async () => {
    const { reports, adapter } = recording();
    const { reporter, settled } = harness(adapter);
    const error = new Error("seen twice");

    reportError(reporter, { error, source: "trpc" });
    reportError(reporter, { error, source: "loader" });
    await settled();

    expect(reports.map((r) => r.source)).toEqual(["trpc"]);
  });

  itVitest("stops after the per-request cap and warns once, so an error loop cannot flood the provider", async () => {
    const warn = vi.spyOn(loggers.server, "warn").mockImplementation(() => {});
    const { reports, adapter } = recording();
    const { reporter, deliveries, settled } = harness(adapter);

    for (let i = 0; i < MAX_REPORTS_PER_REQUEST + 3; i++) {
      reportError(reporter, { error: new Error(`e${i}`), source: "fetch" });
    }
    await settled();

    expect(deliveries).toHaveLength(MAX_REPORTS_PER_REQUEST);
    expect(reports).toHaveLength(MAX_REPORTS_PER_REQUEST);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  itVitest("swallows an adapter failure or defect, so a provider outage cannot fail the request or reject waitUntil", async () => {
    const warn = vi.spyOn(loggers.server, "warn").mockImplementation(() => {});
    for (const send of [
      () => Effect.fail(new ExternalServiceError({ service: "sentry" })),
      () => Effect.die(new Error("adapter bug")),
    ]) {
      const { reporter, deliveries } = harness({ name: "bad", send });

      expect(() =>
        reportError(reporter, { error: new Error("boom"), source: "fetch" })
      ).not.toThrow();
      expect(deliveries).toHaveLength(1);
      await expect(deliveries[0]).resolves.toBeUndefined();
    }
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("ErrorReporterFrom and reportError", () => {
  itVitest("provides the given reporter under the ErrorReporter tag, so Effect code reports to this request", async () => {
    const { reporter } = harness(recording().adapter);
    const runtime = ManagedRuntime.make(ErrorReporterFrom(reporter));

    const resolved: ErrorReporterShape = await runtime.runPromise(ErrorReporter);
    await runtime.dispose();

    expect(resolved).toBe(reporter);
  });

  itVitest("still sends an error after the runtime is disposed, so a late failure in a stream is not lost", async () => {
    const { reports, adapter } = recording();
    const { reporter, settled } = harness(adapter);
    const runtime = ManagedRuntime.make(ErrorReporterFrom(reporter));
    await runtime.runPromise(ErrorReporter);
    await runtime.dispose();

    reportError(reporter, { error: new Error("late"), source: "render" });
    await settled();

    expect(reports.map((r) => r.message)).toEqual(["late"]);
  });
});

describe("the reporter under hostile input and load", () => {
  itVitest("does not throw when reading the error throws, so the fetch handler's catch block cannot fail", async () => {
    const hostile = new Proxy(
      {},
      {
        get: () => {
          throw new Error("trap");
        },
      }
    );
    const warned = vi.spyOn(loggers.server, "warn").mockImplementation(() => {});
    const { adapter, reports } = recording();
    const { reporter, settled } = harness(adapter);

    expect(() => reportError(reporter, { error: hostile, source: "fetch" })).not.toThrow();
    await settled();

    expect(reports).toEqual([]);
    expect(warned).toHaveBeenCalledTimes(1);
  });

  it.effect("stops sending to Sentry once the isolate's budget is spent but keeps the log line, so an error storm cannot burn the backend quota", () =>
    Effect.gen(function* () {
      const fetchFn = vi.fn(async () => ({ ok: true, status: 200 }));
      vi.stubGlobal("fetch", fetchFn);
      const logged = vi.spyOn(loggers.server, "error").mockImplementation(() => {});
      const adapter = selectErrorAdapter(
        {
          ERROR_REPORTER: "sentry",
          SENTRY_DSN: "https://abc123@o0.ingest.example.com/1",
        },
        makeReportBudget({ limit: 1, windowMs: 60_000 })
      );

      yield* adapter.send([sampleReport()]);
      yield* adapter.send([sampleReport()]);

      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(logged).toHaveBeenCalledTimes(2);
    })
  );
});

describe("what reaches the remote backend", () => {
  it.effect("logs a warning-level report without sending it or spending the budget, so posted CSP reports cannot use up the sends real errors need", () =>
    Effect.gen(function* () {
      const fetchFn = vi.fn(async () => ({ ok: true, status: 200 }));
      vi.stubGlobal("fetch", fetchFn);
      const warned = vi.spyOn(loggers.server, "warn").mockImplementation(() => {});
      vi.spyOn(loggers.server, "error").mockImplementation(() => {});
      const adapter = selectErrorAdapter(
        {
          ERROR_REPORTER: "sentry",
          SENTRY_DSN: "https://abc123@o0.ingest.example.com/1",
        },
        makeReportBudget({ limit: 1, windowMs: 60_000 })
      );

      yield* adapter.send([{ ...sampleReport(), level: "warning" }]);
      yield* adapter.send([{ ...sampleReport(), level: "warning" }]);
      yield* adapter.send([sampleReport()]);

      expect(warned).toHaveBeenCalledTimes(2);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    })
  );
});
