import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect, ManagedRuntime } from "effect";

vi.mock("@/auth/server", () => ({
  createAuth: () => ({ api: { getSession: () => Promise.resolve(null) } }),
}));

import { makeAppRuntime, observabilityLayer } from "../runtime";
import type { FetchLike } from "@/services/tracing";
import { currentSpanAnnotations } from "@/services/logger";
import type { RequestContext } from "@/lib/request-context";
import { ErrorReporter, type ErrorReporterShape } from "@/services/error-reporter";

// The wiring under test is `observabilityLayer`, the exact layer
// `makeAppRuntime` puts under the app services. Building the whole app runtime
// would need D1, R2 and Better Auth for no extra coverage.

interface ExportedSpan {
  readonly name: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly attributes: ReadonlyArray<{ key: string; value: { stringValue?: string } }>;
}

const env = { OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318" };

const exportedSpans = (bodies: string[]): ExportedSpan[] =>
  bodies.flatMap(
    (body) => JSON.parse(body).resourceSpans[0].scopeSpans[0].spans as ExportedSpan[]
  );

/** Builds the runtime, runs one child span, disposes, and returns what was exported. */
const runOneRequest = async (request: RequestContext) => {
  const bodies: string[] = [];
  const fetchFn: FetchLike = async (_url, init) => {
    bodies.push(init.body);
    return { ok: true, status: 200 };
  };
  const runtime = ManagedRuntime.make(observabilityLayer(env, request, fetchFn));
  await runtime.runPromise(Effect.void.pipe(Effect.withSpan("child")));
  await runtime.dispose();
  const spans = exportedSpans(bodies);
  const byName = (name: string) => {
    const span = spans.find((s) => s.name === name);
    if (!span) throw new Error(`span ${name} was not exported`);
    return span;
  };
  return { spans, root: byName("http.request"), child: byName("child") };
};

const request = (over: Partial<RequestContext> = {}): RequestContext => ({
  requestId: "req-1",
  method: "GET",
  path: "/dashboard",
  ...over,
});

describe("observabilityLayer with a request", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports the request span and its child as one trace on dispose", async () => {
    // Catches two ordering bugs: building the request span before the OTLP
    // tracer is set (it goes to Effect's default tracer and is never
    // exported), and ending it after TracingLayer's flush (it misses the one
    // export). Also catches dropping `Layer.span`, which leaves `child` a
    // root span in a trace of its own, and `observabilityLayer` not handing
    // the request to the tracer (no span would carry `request.id`).
    const { spans, root, child } = await runOneRequest(request());

    expect(spans.map((s) => s.name).sort()).toEqual(["child", "http.request"]);
    expect(child.traceId).toBe(root.traceId);
    expect(child.parentSpanId).toBe(root.spanId);
    expect(root).not.toHaveProperty("parentSpanId");
    expect(root.attributes).toEqual(
      expect.arrayContaining([
        { key: "request.id", value: { stringValue: "req-1" } },
        { key: "http.request.method", value: { stringValue: "GET" } },
        { key: "url.path", value: { stringValue: "/dashboard" } },
      ])
    );
    expect(child.attributes).toEqual(
      expect.arrayContaining([{ key: "request.id", value: { stringValue: "req-1" } }])
    );
  });

  // Continuing an incoming trace and `user.id` after sign-in are pinned on the
  // real stack in workers/__tests__/request-flow.test.ts.
});

describe("observabilityLayer, logs outside any span", () => {
  it("carry the request span's ids, so they join the request's trace", async () => {
    // `Layer.span` puts the request span in the runtime's context as the
    // parent span; the logger reads it from there. Catches providing the
    // request span per-effect instead (a log outside `withSpan` would carry
    // no traceId).
    const parent = {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      sampled: true,
    };
    const runtime = ManagedRuntime.make(
      observabilityLayer({}, request({ requestId: parent.traceId, parent }))
    );
    const { refs, span } = await runtime.runPromise(
      Effect.all({ refs: Effect.getFiberRefs, span: Effect.currentSpan })
    );
    await runtime.dispose();

    expect(span.name).toBe("http.request");
    expect(currentSpanAnnotations(refs)).toEqual({
      traceId: parent.traceId,
      spanId: span.spanId,
    });
  });
});

describe("makeAppRuntime", () => {
  it("provides the error reporter it was given, so Effect code and plain code report through one per-request budget", async () => {
    const reporter: ErrorReporterShape = { capture: () => Effect.void };
    const runtime = makeAppRuntime(
      {
        DATABASE: {} as D1Database,
        BUCKET: {} as R2Bucket,
        BETTER_AUTH_SECRET: "fake-secret-for-tests",
      } as Env,
      "https://app.example.com",
      request(),
      reporter
    );

    const resolved = await runtime.runPromise(ErrorReporter);
    await runtime.dispose();

    expect(resolved).toBe(reporter);
  });
});
