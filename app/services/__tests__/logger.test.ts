import { describe, expect, it, vi } from "vitest";
import { Effect, Layer, LogLevel, ManagedRuntime } from "effect";
import {
  toAppLevel,
  stringify,
  currentSpanAnnotations,
  currentRequestAnnotations,
  currentRequestLogSampled,
  LoggerLive,
} from "../logger";
import {
  CurrentRequest,
  runWithRequestContext,
  type RequestContext,
} from "@/lib/request-context";

describe("toAppLevel", () => {
  it("maps Trace to trace", () => {
    expect(toAppLevel(LogLevel.Trace)).toBe("trace");
  });

  it("maps Debug to debug", () => {
    expect(toAppLevel(LogLevel.Debug)).toBe("debug");
  });

  it("maps Info to info", () => {
    expect(toAppLevel(LogLevel.Info)).toBe("info");
  });

  it("maps Warning to warn", () => {
    expect(toAppLevel(LogLevel.Warning)).toBe("warn");
  });

  it("maps Error to error", () => {
    expect(toAppLevel(LogLevel.Error)).toBe("error");
  });

  it("maps Fatal to fatal", () => {
    expect(toAppLevel(LogLevel.Fatal)).toBe("fatal");
  });

  it("falls back to info for unmapped levels (e.g. All)", () => {
    expect(toAppLevel(LogLevel.All)).toBe("info");
  });

  it("falls back to info for unmapped levels (e.g. None)", () => {
    expect(toAppLevel(LogLevel.None)).toBe("info");
  });
});

describe("stringify", () => {
  it("returns a string message as-is", () => {
    expect(stringify("hello world")).toBe("hello world");
  });

  it("JSON-stringifies a plain object", () => {
    expect(stringify({ a: 1, b: "two" })).toBe('{"a":1,"b":"two"}');
  });

  it("joins an array of strings with a space", () => {
    expect(stringify(["hello", "world"])).toBe("hello world");
  });

  it("joins a mixed array, JSON-stringifying non-string entries", () => {
    expect(stringify(["msg", { count: 3 }, 42])).toBe(
      'msg {"count":3} 42'
    );
  });
});

describe("currentSpanAnnotations", () => {
  it("returns {} when no span is active, so a log outside a span carries no bogus traceId: undefined key", () => {
    expect(currentSpanAnnotations(Effect.runSync(Effect.getFiberRefs))).toEqual({});
  });

  it("returns the active span's traceId and spanId inside Effect.withSpan, so logs and traces keep joining in the observability backend", () => {
    const { refs, span } = Effect.runSync(
      Effect.gen(function* () {
        return {
          refs: yield* Effect.getFiberRefs,
          span: yield* Effect.currentSpan,
        };
      }).pipe(Effect.withSpan("unit.span"))
    );

    expect(currentSpanAnnotations(refs)).toEqual({
      traceId: span.traceId,
      spanId: span.spanId,
    });
  });
});

describe("LoggerLive", () => {
  it("stamps the active span's traceId onto a log emitted inside that span, so a log in a tRPC procedure span is findable by its trace id", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const traceId = Effect.runSync(
        Effect.gen(function* () {
          yield* Effect.logInfo("inside span");
          return (yield* Effect.currentSpan).traceId;
        }).pipe(Effect.withSpan("unit.span"), Effect.provide(LoggerLive))
      );

      const output = spy.mock.calls.map((args) => String(args[0])).join("\n");
      expect(output).toContain("inside span");
      expect(output).toContain(traceId);
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps explicit log annotations alongside the span ones, so the span seed adds to the event's own annotations and does not replace them", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      Effect.runSync(
        Effect.logInfo("annotated").pipe(
          Effect.annotateLogs({ layer: "trpc", requestId: "req-1" }),
          Effect.withSpan("unit.span"),
          Effect.provide(LoggerLive)
        )
      );

      const output = spy.mock.calls.map((args) => String(args[0])).join("\n");
      expect(output).toContain("[trpc]");
      expect(output).toContain("req-1");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("currentRequestAnnotations", () => {
  const request: RequestContext = { requestId: "req-fiber", method: "GET", path: "/", userId: "u1" };

  it("returns the request and user ids when CurrentRequest is in the fiber context, so every Effect log line keeps its request id", () => {
    const refs = Effect.runSync(
      Effect.getFiberRefs.pipe(Effect.provide(Layer.succeed(CurrentRequest, request)))
    );
    expect(currentRequestAnnotations(refs)).toStrictEqual({
      requestId: "req-fiber",
      userId: "u1",
    });
  });

  it("returns {} without CurrentRequest", () => {
    expect(currentRequestAnnotations(Effect.runSync(Effect.getFiberRefs))).toStrictEqual({});
  });
});

describe("LoggerLive with a request (Effect's scheduler is shared across requests, so a fiber can resume inside another request's async context, and the fiber's own CurrentRequest must win over the store)", () => {
  it("stamps the runtime's request id on a log, over the async-local store's (the dev line shows the first 8 characters of the id)", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const runtime = ManagedRuntime.make(
      Layer.merge(
        LoggerLive,
        Layer.succeed(CurrentRequest, {
          requestId: "fiber-request-id",
          method: "GET",
          path: "/",
        })
      )
    );
    try {
      await runWithRequestContext(
        { requestId: "other-request-id", method: "GET", path: "/" },
        () => runtime.runPromise(Effect.logInfo("through runtime"))
      );

      const output = spy.mock.calls.map((args) => String(args[0])).join("\n");
      expect(output).toContain("through runtime");
      expect(output).toContain("(fiber-re)");
      expect(output).not.toContain("(other-re)");
    } finally {
      spy.mockRestore();
      await runtime.dispose();
    }
  });
});

const baseRequest: RequestContext = { requestId: "fiber-request-id", method: "GET", path: "/" };

describe("currentRequestLogSampled", () => {
  const refsWith = (request: RequestContext) =>
    Effect.runSync(
      Effect.getFiberRefs.pipe(Effect.provide(Layer.succeed(CurrentRequest, request)))
    );

  it("reads the fiber request's log decision, keeps a request with no decision, and is undefined with no request, so the sink falls back to the async store only outside the runtime", () => {
    expect(
      currentRequestLogSampled(
        refsWith({ ...baseRequest, sampling: { logs: false, traces: true } })
      )
    ).toBe(false);
    expect(
      currentRequestLogSampled(refsWith({ requestId: "r", method: "GET", path: "/" }))
    ).toBe(true);
    expect(currentRequestLogSampled(Effect.runSync(Effect.getFiberRefs))).toBeUndefined();
  });
});

describe("LoggerLive with a sampled request", () => {
  const runLogs = async (
    layer: Layer.Layer<never>,
    store: RequestContext
  ) => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runtime = ManagedRuntime.make(Layer.merge(LoggerLive, layer));
    try {
      await runWithRequestContext(store, () =>
        runtime.runPromise(
          Effect.logInfo("info line").pipe(Effect.zipRight(Effect.logWarning("warn line")))
        )
      );
      return {
        info: infoSpy.mock.calls.map(([line]) => String(line)).join("\n"),
        warn: warnSpy.mock.calls.map(([line]) => String(line)).join("\n"),
      };
    } finally {
      infoSpy.mockRestore();
      warnSpy.mockRestore();
      await runtime.dispose();
    }
  };

  it("drops Effect.logInfo and keeps Effect.logWarning of a fiber request sampled out, even while the async store holds a sampled request", async () => {
    const out = await runLogs(
      Layer.succeed(CurrentRequest, { ...baseRequest, sampling: { logs: false, traces: true } }),
      { ...baseRequest, requestId: "other-request-id", sampling: { logs: true, traces: true } }
    );

    expect(out.info).not.toContain("info line");
    expect(out.warn).toContain("warn line");
  });

  it("follows the async store's decision when the runtime has no request, so an Effect log outside the request runtime is still sampled", async () => {
    const dropped = await runLogs(Layer.empty, {
      ...baseRequest,
      sampling: { logs: false, traces: true },
    });
    const kept = await runLogs(Layer.empty, {
      ...baseRequest,
      sampling: { logs: true, traces: true },
    });

    expect(dropped.info).not.toContain("info line");
    expect(dropped.warn).toContain("warn line");
    expect(kept.info).toContain("info line");
  });
});
