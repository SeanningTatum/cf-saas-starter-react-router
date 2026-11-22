import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import {
  Context,
  Effect,
  Exit,
  Logger,
  ManagedRuntime,
  Option,
} from "effect";
import {
  MAX_BUFFERED_SPANS,
  OtlpSpan,
  TracingLayer,
  flushSpans,
  makeOtlpTracer,
  makeSpanBuffer,
  parseOtlpHeaders,
  readTracingConfig,
  type FetchLike,
  type TracingConfig,
} from "../tracing";
import { buildOtlpPayload, toOtlpValue } from "../tracing-otlp";
import type { RequestContext } from "@/lib/request-context";


interface ExportCall {
  readonly url: string;
  readonly init: { method: string; headers: Record<string, string>; body: string };
}

const stubFetch = (result: { ok: boolean; status: number } | Error = { ok: true, status: 200 }) => {
  const calls: ExportCall[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    if (result instanceof Error) throw result;
    return result;
  };
  return { calls, fetchFn };
};

const captureLogs = () => {
  const messages: string[] = [];
  const layer = Logger.replace(
    Logger.defaultLogger,
    Logger.make(({ message }) => {
      messages.push(String(message));
    })
  );
  return { messages, layer };
};

const config = (over: Partial<TracingConfig> = {}): TracingConfig => ({
  url: "http://collector:4318/v1/traces",
  headers: {},
  serviceName: "svc",
  ...over,
});

const makeSpan = (
  name: string,
  buffer = makeSpanBuffer(),
  parent: Option.Option<OtlpSpan> = Option.none(),
  startTime = 100n,
  kind: "internal" | "client" | "server" = "internal"
) => new OtlpSpan(name, parent, [], startTime, kind, buffer);


describe("parseOtlpHeaders", () => {
  it("splits on commas, trims, and percent-decodes values, so Bearer%20abc is not sent verbatim (a 401) and padded keys stay valid", () => {
    expect(parseOtlpHeaders(" Authorization = Bearer%20abc , x-scope=team%2Fa ")).toEqual({
      Authorization: "Bearer abc",
      "x-scope": "team/a",
    });
  });

  it("splits each pair on the FIRST '=' only, keeping '=' inside the value, so base64 credentials ending in '=' are not truncated", () => {
    expect(parseOtlpHeaders("Authorization=Basic dXNlcjpwYXNz==")).toEqual({
      Authorization: "Basic dXNlcjpwYXNz==",
    });
  });

  it("skips malformed pairs (no '=', leading '=', blank key) and keeps the rest, so an =orphan pair never yields an empty header name", () => {
    expect(parseOtlpHeaders("novalue,=orphan, =spaced,ok=1")).toEqual({ ok: "1" });
  });

  it("falls back to the raw value when percent-decoding throws, so a stray % in a header value cannot take down config parsing", () => {
    expect(parseOtlpHeaders("k=100%oops")).toEqual({ k: "100%oops" });
  });

  it("returns {} for undefined and for an empty string", () => {
    expect(parseOtlpHeaders(undefined)).toEqual({});
    expect(parseOtlpHeaders("")).toEqual({});
  });
});


describe("readTracingConfig", () => {
  it("returns null when the endpoint is missing, empty, or not a string, so the tracer never POSTs to /v1/traces on every request", () => {
    expect(readTracingConfig({})).toBeNull();
    expect(readTracingConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: "" })).toBeNull();
    expect(readTracingConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 4318 })).toBeNull();
  });

  it("strips trailing slashes and appends /v1/traces to a base endpoint", () => {
    expect(
      readTracingConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318//" })?.url
    ).toBe("http://collector:4318/v1/traces");
  });

  it("does not double-append when the endpoint already ends in /v1/traces, which would 404", () => {
    expect(
      readTracingConfig({
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://api.honeycomb.io/v1/traces/",
      })?.url
    ).toBe("https://api.honeycomb.io/v1/traces");
  });

  it("defaults serviceName to cf-saas-starter and headers to {} when unset", () => {
    const result = readTracingConfig({
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
    });
    expect(result?.serviceName).toBe("cf-saas-starter");
    expect(result?.headers).toEqual({});
  });

  it("reads serviceName and headers from their env vars when set, so span exports are authenticated against a hosted collector", () => {
    const result = readTracingConfig({
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
      OTEL_EXPORTER_OTLP_HEADERS: "x-api-key=abc123",
      OTEL_SERVICE_NAME: "my-worker",
    });
    expect(result?.serviceName).toBe("my-worker");
    expect(result?.headers).toEqual({ "x-api-key": "abc123" });
  });
});


describe("OtlpSpan", () => {
  it("inherits the parent's traceId while getting its own spanId, so child spans stay in one trace and log/trace correlation holds", () => {
    const buffer = makeSpanBuffer();
    const parent = makeSpan("parent", buffer);
    const child = makeSpan("child", buffer, Option.some(parent));

    expect(child.traceId).toBe(parent.traceId);
    expect(child.spanId).not.toBe(parent.spanId);
    expect(parent.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(child.spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("buffers itself on end() and records the exit as its status", () => {
    const buffer = makeSpanBuffer();
    const span = makeSpan("work", buffer);
    expect(buffer.spans).toHaveLength(0);

    span.end(200n, Exit.fail("nope"));

    expect(buffer.spans).toEqual([span]);
    expect(span.status._tag).toBe("Ended");
    if (span.status._tag === "Ended") {
      expect(span.status.startTime).toBe(100n);
      expect(span.status.endTime).toBe(200n);
      expect(Exit.isFailure(span.status.exit)).toBe(true);
    }
  });

  it(`counts a span as dropped instead of buffering it past MAX_BUFFERED_SPANS, keeping the 1000th span and dropping the 1001st, so a hot request cannot grow the buffer until the worker runs out of memory`, () => {
    const buffer = makeSpanBuffer();
    for (let i = 0; i < MAX_BUFFERED_SPANS; i++) {
      makeSpan(`s${i}`, buffer).end(200n, Exit.void);
    }
    expect(buffer.spans).toHaveLength(MAX_BUFFERED_SPANS);
    expect(buffer.dropped).toBe(0);

    makeSpan("overflow", buffer).end(200n, Exit.void);

    expect(buffer.spans).toHaveLength(MAX_BUFFERED_SPANS);
    expect(buffer.dropped).toBe(1);
    expect(buffer.spans.some((s) => s.name === "overflow")).toBe(false);
  });
});

describe("makeOtlpTracer", () => {
  it("creates spans wired to the buffer it was built with, so the flush finalizer holds the same buffer and exports its spans", () => {
    const buffer = makeSpanBuffer();
    const span = makeOtlpTracer(buffer).span(
      "manual",
      Option.none(),
      Context.empty(),
      [],
      50n,
      "server"
    );

    expect(span).toBeInstanceOf(OtlpSpan);
    expect(span.name).toBe("manual");
    expect(span.kind).toBe("server");
    span.end(60n, Exit.void);
    expect(buffer.spans).toHaveLength(1);
  });

  const startSpan = (tracer: ReturnType<typeof makeOtlpTracer>, name: string) =>
    tracer.span(name, Option.none(), Context.empty(), [], 50n, "internal");

  it("stamps request.id on every span when built with a request, so child spans can be found by request id in the trace backend", () => {
    const tracer = makeOtlpTracer(makeSpanBuffer(), {
      requestId: "req-1",
      method: "GET",
      path: "/",
    });
    expect(startSpan(tracer, "a").attributes.get("request.id")).toBe("req-1");
  });

  it("adds user.id only to spans started after the request's user is set (userId is set when the session resolves), never as undefined on anonymous spans", () => {
    const request: RequestContext = { requestId: "req-1", method: "GET", path: "/" };
    const tracer = makeOtlpTracer(makeSpanBuffer(), request);

    const before = startSpan(tracer, "before");
    request.userId = "u1";
    const after = startSpan(tracer, "after");

    expect(before.attributes.has("user.id")).toBe(false);
    expect(after.attributes.get("user.id")).toBe("u1");
  });

  it("sets neither attribute without a request", () => {
    const span = startSpan(makeOtlpTracer(makeSpanBuffer()), "plain");
    expect(span.attributes.has("request.id")).toBe(false);
    expect(span.attributes.has("user.id")).toBe(false);
  });
});


describe("toOtlpValue", () => {
  it("maps integers to intValue strings and non-integers to doubleValue, since OTLP rejects 1.5 in intValue and wants intValue as a string", () => {
    expect(toOtlpValue(42)).toEqual({ intValue: "42" });
    expect(toOtlpValue(1.5)).toEqual({ doubleValue: 1.5 });
    expect(toOtlpValue(9007199254740993n)).toEqual({ intValue: "9007199254740993" });
  });

  it("maps strings and booleans to their own typed fields", () => {
    expect(toOtlpValue("hi")).toEqual({ stringValue: "hi" });
    expect(toOtlpValue(false)).toEqual({ boolValue: false });
  });

  it("JSON-encodes objects and never emits a missing stringValue, so an undefined attribute does not serialize as {} and break the collector", () => {
    expect(toOtlpValue({ a: 1 })).toEqual({ stringValue: '{"a":1}' });
    expect(toOtlpValue(undefined)).toEqual({ stringValue: "undefined" });
  });
});

describe("buildOtlpPayload", () => {
  const built = () => {
    const buffer = makeSpanBuffer();
    const parent = makeSpan("trpc.user.getUsers", buffer, Option.none(), 100n, "server");
    const child = makeSpan("db.query user", buffer, Option.some(parent), 200n, "client");
    child.attribute("db.entity", "user");
    child.event("retry", 250n, { attempt: 1 });
    child.end(300n, Exit.void);
    const payload = buildOtlpPayload([child], "svc");
    return { parent, child, span: payload.resourceSpans[0].scopeSpans[0].spans[0], payload };
  };

  it("puts service.name on the resource", () => {
    expect(built().payload.resourceSpans[0].resource.attributes).toEqual([
      { key: "service.name", value: { stringValue: "svc" } },
    ]);
  });

  it("emits ids, parent link, numeric kind, nanosecond strings and attributes, with bigint timestamps as strings and the kind as 3, not client", () => {
    const { parent, child, span } = built();
    expect(span.traceId).toBe(parent.traceId);
    expect(span.spanId).toBe(child.spanId);
    expect(span.parentSpanId).toBe(parent.spanId);
    expect(span.name).toBe("db.query user");
    expect(span.kind).toBe(3);
    expect(span.startTimeUnixNano).toBe("200");
    expect(span.endTimeUnixNano).toBe("300");
    expect(span.attributes).toEqual([
      { key: "db.entity", value: { stringValue: "user" } },
    ]);
    expect(span.events).toEqual([
      {
        name: "retry",
        timeUnixNano: "250",
        attributes: [{ key: "attempt", value: { intValue: "1" } }],
      },
    ]);
  });

  it("omits parentSpanId entirely for a root span, since collectors reject a present-but-null parent id and root spans would look orphaned", () => {
    const buffer = makeSpanBuffer();
    const root = makeSpan("root", buffer);
    root.end(200n, Exit.void);
    const span = buildOtlpPayload([root], "svc").resourceSpans[0].scopeSpans[0].spans[0];
    expect(span).not.toHaveProperty("parentSpanId");
  });

  it("marks a successful span OK (1) and a failed span ERROR (2) with a truncated message, so no span is red by inversion and a huge cause cannot bloat exports", () => {
    const buffer = makeSpanBuffer();
    const ok = makeSpan("ok", buffer);
    ok.end(200n, Exit.void);
    const bad = makeSpan("bad", buffer);
    bad.end(200n, Exit.fail(new Error("boom".padEnd(2000, "!"))));

    const [okOut, badOut] = buildOtlpPayload([ok, bad], "svc").resourceSpans[0]
      .scopeSpans[0].spans as ReadonlyArray<{
      status: { code: number; message?: string };
    }>;
    expect(okOut.status).toEqual({ code: 1 });
    expect(badOut.status.code).toBe(2);
    expect(badOut.status.message).toContain("boom");
    expect(badOut.status.message!.length).toBeLessThanOrEqual(512);
  });
});


describe("flushSpans", () => {
  it.effect("does not call fetch when the buffer is empty", () =>
    Effect.gen(function* () {
      const { calls, fetchFn } = stubFetch();
      yield* flushSpans(config(), makeSpanBuffer(), fetchFn);
      expect(calls).toHaveLength(0);
    })
  );

  it.effect("POSTs one JSON request to config.url with content-type + config headers, so a hosted collector does not reject every export as unauthenticated", () =>
    Effect.gen(function* () {
      const { calls, fetchFn } = stubFetch();
      const buffer = makeSpanBuffer();
      makeSpan("work", buffer).end(200n, Exit.void);

      yield* flushSpans(
        config({ headers: { "x-api-key": "abc" } }),
        buffer,
        fetchFn
      );

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("http://collector:4318/v1/traces");
      expect(calls[0].init.method).toBe("POST");
      expect(calls[0].init.headers).toEqual({
        "content-type": "application/json",
        "x-api-key": "abc",
      });
      const body = JSON.parse(calls[0].init.body);
      expect(body.resourceSpans[0].scopeSpans[0].spans.map((s: { name: string }) => s.name)).toEqual(
        ["work"]
      );
    })
  );

  it.effect("drains the buffer so a second flush exports nothing, so earlier spans are never re-sent as duplicate traces", () =>
    Effect.gen(function* () {
      const { calls, fetchFn } = stubFetch();
      const buffer = makeSpanBuffer();
      makeSpan("work", buffer).end(200n, Exit.void);

      yield* flushSpans(config(), buffer, fetchFn);
      yield* flushSpans(config(), buffer, fetchFn);

      expect(calls).toHaveLength(1);
      expect(buffer.spans).toHaveLength(0);
    })
  );

  it.effect("succeeds (never fails the app) and logs when the collector returns !ok, so a down collector cannot fail every request that flushes spans", () =>
    Effect.gen(function* () {
      const { messages, layer } = captureLogs();
      const { calls, fetchFn } = stubFetch({ ok: false, status: 503 });
      const buffer = makeSpanBuffer();
      makeSpan("work", buffer).end(200n, Exit.void);

      const exit = yield* Effect.exit(
        flushSpans(config(), buffer, fetchFn).pipe(Effect.provide(layer))
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      expect(calls).toHaveLength(1);
      expect(messages).toContain("tracing.export_failed");
    })
  );

  it.effect("succeeds and logs when fetch itself rejects", () =>
    Effect.gen(function* () {
      const { messages, layer } = captureLogs();
      const { fetchFn } = stubFetch(new Error("network down"));
      const buffer = makeSpanBuffer();
      makeSpan("work", buffer).end(200n, Exit.void);

      const exit = yield* Effect.exit(
        flushSpans(config(), buffer, fetchFn).pipe(Effect.provide(layer))
      );

      expect(Exit.isSuccess(exit)).toBe(true);
      expect(messages).toContain("tracing.export_failed");
    })
  );

  it.effect("reports dropped spans once and resets the counter, so the warning does not repeat on every later flush", () =>
    Effect.gen(function* () {
      const { messages, layer } = captureLogs();
      const { fetchFn } = stubFetch();
      const buffer = makeSpanBuffer();
      makeSpan("work", buffer).end(200n, Exit.void);
      buffer.dropped = 3;

      yield* flushSpans(config(), buffer, fetchFn).pipe(Effect.provide(layer));

      expect(messages).toContain("tracing.spans_dropped");
      expect(buffer.dropped).toBe(0);
    })
  );
});


describe("TracingLayer", () => {
  it("exports the spans recorded by the runtime when the runtime is disposed, and nothing mid-request, so the flush finalizer exists and the URL comes from the endpoint env var", async () => {
    const { calls, fetchFn } = stubFetch();
    const runtime = ManagedRuntime.make(
      TracingLayer({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" }, fetchFn)
    );

    await runtime.runPromise(Effect.void.pipe(Effect.withSpan("test.span")));
    expect(calls).toHaveLength(0);

    await runtime.dispose();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://localhost:4318/v1/traces");
    const body = JSON.parse(calls[0].init.body);
    expect(body.resourceSpans[0].resource.attributes).toEqual([
      { key: "service.name", value: { stringValue: "cf-saas-starter" } },
    ]);
    expect(
      body.resourceSpans[0].scopeSpans[0].spans.map((s: { name: string }) => s.name)
    ).toContain("test.span");
  });

  it("exports nothing when OTEL_EXPORTER_OTLP_ENDPOINT is unset, so an unconfigured deploy never fetches a bogus URL on every request", async () => {
    const { calls, fetchFn } = stubFetch();
    const runtime = ManagedRuntime.make(TracingLayer({}, fetchFn));
    await runtime.runPromise(Effect.void.pipe(Effect.withSpan("test.span")));
    await runtime.dispose();

    expect(calls).toHaveLength(0);
  });
});
