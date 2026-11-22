import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect, ManagedRuntime } from "effect";

vi.mock("@/auth/server", () => ({
  createAuth: () => ({ api: { getSession: () => Promise.resolve(null) } }),
}));

import { makeAppRuntime, observabilityLayer } from "../runtime";
import { RateLimiter } from "@/services/rate-limit";
import { RATE_LIMIT_BINDINGS } from "@/lib/constants/rate-limit";
import type { FetchLike } from "@/services/tracing";
import { currentSpanAnnotations } from "@/services/logger";
import type { RequestContext } from "@/lib/request-context";
import { ErrorReporter, type ErrorReporterShape } from "@/services/error-reporter";

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

describe("observabilityLayer, the exact layer makeAppRuntime puts under the app services (the whole runtime would need D1, R2 and Better Auth for no extra coverage), with a request; continuing an incoming trace and user.id after sign-in are pinned on the real stack in workers/__tests__/request-flow.test.ts", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports the request span and its child as one trace on dispose, so the span is built after the tracer is set and ends before the flush", async () => {
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

});

describe("observabilityLayer, logs outside any span", () => {
  it("carry the request span's ids, so they join the request's trace even when the request span is provided by Layer.span and not per effect", async () => {
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

describe("makeAppRuntime rate limiter", () => {
  it("provides RateLimiter backed by the env's binding, so routes limit with the real counter", async () => {
    const keys: string[] = [];
    const binding: RateLimit = {
      limit: async ({ key }) => {
        keys.push(key);
        return { success: true };
      },
    };
    const env = {
      DATABASE: {},
      BUCKET: {},
      BETTER_AUTH_SECRET: "runtime-test-secret-not-real-0000000000",
      BETTER_AUTH_URL: "https://app.example.test",
      [RATE_LIMIT_BINDINGS.signIn]: binding,
    } as unknown as Env;
    const runtime = makeAppRuntime(env, { dev: false });

    await runtime.runPromise(Effect.flatMap(RateLimiter, (limiter) => limiter.check("signIn", "198.51.100.200")));
    await runtime.dispose();

    expect(keys).toEqual(["198.51.100.200"]);
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
      { dev: true, requestOrigin: "https://app.example.com" },
      request(),
      reporter
    );

    const resolved = await runtime.runPromise(ErrorReporter);
    await runtime.dispose();

    expect(resolved).toBe(reporter);
  });
});
