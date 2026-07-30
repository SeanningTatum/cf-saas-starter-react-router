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
  buildOtlpPayload,
  flushSpans,
  makeOtlpTracer,
  makeSpanBuffer,
  parseOtlpHeaders,
  readTracingConfig,
  toOtlpValue,
  type FetchLike,
  type TracingConfig,
} from "../tracing";

// --- helpers ------------------------------------------------------------------

interface ExportCall {
  readonly url: string;
  readonly init: { method: string; headers: Record<string, string>; body: string };
}

/** Records every OTLP POST so tests can assert the wire payload. */
const stubFetch = (result: { ok: boolean; status: number } | Error = { ok: true, status: 200 }) => {
  const calls: ExportCall[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    if (result instanceof Error) throw result;
    return result;
  };
  return { calls, fetchFn };
};

/** Captures log messages so the swallowed-export-failure path is observable. */
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

// --- parseOtlpHeaders ---------------------------------------------------------

describe("parseOtlpHeaders", () => {
  it("splits on commas, trims, and percent-decodes values", () => {
    // Catches: dropping decodeURIComponent (an "Authorization=Bearer%20abc"
    // header would be sent verbatim and the collector would 401) or dropping
    // the trims (header keys/values with surrounding spaces are invalid).
    expect(parseOtlpHeaders(" Authorization = Bearer%20abc , x-scope=team%2Fa ")).toEqual({
      Authorization: "Bearer abc",
      "x-scope": "team/a",
    });
  });

  it("splits each pair on the FIRST '=' only, keeping '=' inside the value", () => {
    // Catches: rewriting the parser as pair.split("=") — base64 credentials
    // end in "=" and would be silently truncated.
    expect(parseOtlpHeaders("Authorization=Basic dXNlcjpwYXNz==")).toEqual({
      Authorization: "Basic dXNlcjpwYXNz==",
    });
  });

  it("skips malformed pairs (no '=', leading '=', blank key) and keeps the rest", () => {
    // Catches: relaxing `eq <= 0` to `eq < 0` (an "=orphan" pair would produce
    // an illegal empty header name) or dropping the `!key` guard.
    expect(parseOtlpHeaders("novalue,=orphan, =spaced,ok=1")).toEqual({ ok: "1" });
  });

  it("falls back to the raw value when percent-decoding throws", () => {
    // Catches: removing Effect.orElseSucceed — a stray '%' in a header value
    // would make decodeURIComponent throw and take down config parsing.
    expect(parseOtlpHeaders("k=100%oops")).toEqual({ k: "100%oops" });
  });

  it("returns {} for undefined and for an empty string", () => {
    expect(parseOtlpHeaders(undefined)).toEqual({});
    expect(parseOtlpHeaders("")).toEqual({});
  });
});

// --- readTracingConfig -------------------------------------------------------

describe("readTracingConfig", () => {
  it("returns null when the endpoint is missing, empty, or not a string", () => {
    // Catches: a truthiness change that turns "" into a config and makes the
    // tracer POST to "/v1/traces" on every request.
    expect(readTracingConfig({})).toBeNull();
    expect(readTracingConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: "" })).toBeNull();
    expect(readTracingConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 4318 })).toBeNull();
  });

  it("strips trailing slashes and appends /v1/traces to a base endpoint", () => {
    expect(
      readTracingConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318//" })?.url
    ).toBe("http://collector:4318/v1/traces");
  });

  it("does not double-append when the endpoint already ends in /v1/traces", () => {
    // Catches: unconditional concatenation → ".../v1/traces/v1/traces" (404s).
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

  it("reads serviceName and headers from their env vars when set", () => {
    // Catches: wiring headers off the wrong env var — every span export would
    // be unauthenticated against a hosted collector.
    const result = readTracingConfig({
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
      OTEL_EXPORTER_OTLP_HEADERS: "x-api-key=abc123",
      OTEL_SERVICE_NAME: "my-worker",
    });
    expect(result?.serviceName).toBe("my-worker");
    expect(result?.headers).toEqual({ "x-api-key": "abc123" });
  });
});

// --- OtlpSpan / tracer -------------------------------------------------------

describe("OtlpSpan", () => {
  it("inherits the parent's traceId while getting its own spanId", () => {
    // Catches: generating a fresh traceId per span — child spans would land in
    // separate traces and log/trace correlation would break entirely.
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

  it(`counts a span as dropped instead of buffering it past MAX_BUFFERED_SPANS`, () => {
    // Boundary: the 1000th span is kept, the 1001st is dropped. Catches a
    // `>` / `>=` flip (unbounded buffer → worker OOM on a hot request).
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
  it("creates spans wired to the buffer it was built with", () => {
    // Catches: allocating a buffer inside makeOtlpTracer — the flush finalizer
    // would hold a different (always empty) buffer and export nothing.
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
});

// --- OTLP encoding -----------------------------------------------------------

describe("toOtlpValue", () => {
  it("maps integers to intValue strings and non-integers to doubleValue", () => {
    // Catches: dropping the Number.isInteger branch — OTLP rejects a payload
    // that puts 1.5 in intValue (and intValue must be a string, not a number).
    expect(toOtlpValue(42)).toEqual({ intValue: "42" });
    expect(toOtlpValue(1.5)).toEqual({ doubleValue: 1.5 });
    expect(toOtlpValue(9007199254740993n)).toEqual({ intValue: "9007199254740993" });
  });

  it("maps strings and booleans to their own typed fields", () => {
    expect(toOtlpValue("hi")).toEqual({ stringValue: "hi" });
    expect(toOtlpValue(false)).toEqual({ boolValue: false });
  });

  it("JSON-encodes objects and never emits a missing stringValue", () => {
    // JSON.stringify(undefined) is undefined — without the `?? "undefined"`
    // fallback the attribute would serialize as `{}` and break the collector.
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

  it("emits ids, parent link, numeric kind, nanosecond strings and attributes", () => {
    // Catches: dropping `.toString()` on the bigint timestamps (JSON.stringify
    // throws on bigint), or sending the kind as the literal string "client"
    // instead of 3.
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

  it("omits parentSpanId entirely for a root span", () => {
    // Catches: `parentSpanId: undefined` — collectors reject a present-but-null
    // parent id, and it would make every root span look orphaned.
    const buffer = makeSpanBuffer();
    const root = makeSpan("root", buffer);
    root.end(200n, Exit.void);
    const span = buildOtlpPayload([root], "svc").resourceSpans[0].scopeSpans[0].spans[0];
    expect(span).not.toHaveProperty("parentSpanId");
  });

  it("marks a successful span OK (1) and a failed span ERROR (2) with a truncated message", () => {
    // Catches: inverting the status codes (every span red in the trace UI) and
    // removing the 512-char clamp (a huge cause would bloat every export).
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

// --- flushSpans --------------------------------------------------------------

describe("flushSpans", () => {
  it.effect("does not call fetch when the buffer is empty", () =>
    Effect.gen(function* () {
      const { calls, fetchFn } = stubFetch();
      yield* flushSpans(config(), makeSpanBuffer(), fetchFn);
      expect(calls).toHaveLength(0);
    })
  );

  it.effect("POSTs one JSON request to config.url with content-type + config headers", () =>
    Effect.gen(function* () {
      // Catches: dropping the content-type or the config headers spread — a
      // hosted collector would reject every export as unauthenticated.
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

  it.effect("drains the buffer so a second flush exports nothing", () =>
    Effect.gen(function* () {
      // Catches: reading buffer.spans without splicing — every flush would
      // re-send all previously exported spans (duplicate traces).
      const { calls, fetchFn } = stubFetch();
      const buffer = makeSpanBuffer();
      makeSpan("work", buffer).end(200n, Exit.void);

      yield* flushSpans(config(), buffer, fetchFn);
      yield* flushSpans(config(), buffer, fetchFn);

      expect(calls).toHaveLength(1);
      expect(buffer.spans).toHaveLength(0);
    })
  );

  it.effect("succeeds (never fails the app) and logs when the collector returns !ok", () =>
    Effect.gen(function* () {
      // Catches: letting an export failure propagate — a down collector would
      // fail every request that flushes spans.
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

  it.effect("reports dropped spans once and resets the counter", () =>
    Effect.gen(function* () {
      // Catches: forgetting `buffer.dropped = 0` — the warning would repeat on
      // every subsequent flush for the lifetime of the buffer.
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

// --- TracingLayer ------------------------------------------------------------

describe("TracingLayer", () => {
  it("exports the spans recorded by the runtime when the runtime is disposed", async () => {
    // Catches: losing the flush finalizer (spans buffer forever and nothing is
    // ever exported) or building the wrong URL from the endpoint env var.
    const { calls, fetchFn } = stubFetch();
    const runtime = ManagedRuntime.make(
      TracingLayer({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" }, fetchFn)
    );

    await runtime.runPromise(Effect.void.pipe(Effect.withSpan("test.span")));
    expect(calls).toHaveLength(0); // nothing exported mid-request

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

  it("exports nothing when OTEL_EXPORTER_OTLP_ENDPOINT is unset", async () => {
    // Catches: inverting the `if (!config)` guard — an unconfigured deploy
    // would fetch a bogus URL on every request.
    const { calls, fetchFn } = stubFetch();
    const runtime = ManagedRuntime.make(TracingLayer({}, fetchFn));
    await runtime.runPromise(Effect.void.pipe(Effect.withSpan("test.span")));
    await runtime.dispose();

    expect(calls).toHaveLength(0);
  });
});
