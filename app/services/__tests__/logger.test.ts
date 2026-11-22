import { describe, expect, it, vi } from "vitest";
import { Effect, Layer, LogLevel, ManagedRuntime } from "effect";
import {
  toAppLevel,
  stringify,
  currentSpanAnnotations,
  currentRequestAnnotations,
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
  it("returns {} when no span is active", () => {
    // Catches: reading the span off the wrong FiberRef and producing
    // `{ traceId: undefined }` — every log outside a span would carry a bogus
    // correlation key.
    expect(currentSpanAnnotations(Effect.runSync(Effect.getFiberRefs))).toEqual({});
  });

  it("returns the active span's traceId and spanId inside Effect.withSpan", () => {
    // Catches: dropping either field — logs and traces stop joining in the
    // observability backend, which is the whole point of the feature.
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
  it("stamps the active span's traceId onto a log emitted inside that span", () => {
    // The regression: a log line written inside a tRPC procedure span must be
    // findable by that trace's id. Catches removing the
    // `currentSpanAnnotations(context)` seed from customLogger's annotations.
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

  it("keeps explicit log annotations alongside the span ones", () => {
    // The span seed must be a seed, not a replacement: catches a refactor that
    // passes only `currentSpanAnnotations(context)` to emitLog and drops the
    // event's own annotations (`layer: "trpc"`, requestId, ...).
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

  it("returns the request and user ids when CurrentRequest is in the fiber context", () => {
    // Catches reading the wrong tag or FiberRef: every Effect log line would
    // lose its request id.
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

describe("LoggerLive with a request", () => {
  it("stamps the runtime's request id on a log, over the async-local store's", async () => {
    // The regression the design guards against: Effect's scheduler is shared
    // across requests, so a fiber can resume inside another request's async
    // context. The fiber's own CurrentRequest must win over the store.
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
      // the dev line shows the first 8 characters of the request id
      expect(output).toContain("(fiber-re)");
      expect(output).not.toContain("(other-re)");
    } finally {
      spy.mockRestore();
      await runtime.dispose();
    }
  });
});
