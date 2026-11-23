import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Exit, ManagedRuntime, Option } from "effect";
import { HTTP_STATUS_ATTRIBUTE } from "@/lib/constants/error-reporting";
import { makeReportBudget } from "@/lib/error-reporting/report-budget";
import type { RequestContext } from "@/lib/request-context";
import {
  OtlpSpan,
  TracingLayer,
  flushSpans,
  makeSpanBuffer,
  type FetchLike,
  type SpanBuffer,
  type TracingConfig,
} from "../tracing";
import { isErrorSpan } from "../tracing-otlp";

const config: TracingConfig = {
  url: "http://collector:4318/v1/traces",
  headers: {},
  serviceName: "svc",
};

const stubFetch = () => {
  const bodies: string[] = [];
  const fetchFn: FetchLike = async (_url, init) => {
    bodies.push(init.body);
    return { ok: true, status: 200 };
  };
  return { bodies, fetchFn };
};

const exportedNames = (body: string | undefined): string[] =>
  JSON.parse(body ?? "{}").resourceSpans[0].scopeSpans[0].spans.map(
    (span: { name: string }) => span.name,
  );

const startSpan = (name: string, buffer: SpanBuffer = makeSpanBuffer()) =>
  new OtlpSpan(name, Option.none(), [], 100n, "internal", buffer);

const okSpan = (name: string, buffer: SpanBuffer) => startSpan(name, buffer).end(200n, Exit.void);

const failedSpan = (name: string, buffer: SpanBuffer) =>
  startSpan(name, buffer).end(200n, Exit.fail("boom"));

const answeredSpan = (name: string, buffer: SpanBuffer, status: number) => {
  const span = startSpan(name, buffer);
  span.attribute(HTTP_STATUS_ATTRIBUTE, status);
  span.end(200n, Exit.void);
};

describe("isErrorSpan", () => {
  it("is true for a failed exit or a 5xx response and false otherwise, so only a broken request forces an export", () => {
    const ended = (exit: Exit.Exit<unknown, unknown>, status?: number) => {
      const span = startSpan("s");
      if (status !== undefined) span.attribute(HTTP_STATUS_ATTRIBUTE, status);
      span.end(200n, exit);
      return span;
    };

    expect(isErrorSpan(ended(Exit.fail("boom")))).toBe(true);
    expect(isErrorSpan(ended(Exit.void, 500))).toBe(true);
    expect(isErrorSpan(ended(Exit.void, 499))).toBe(false);
    expect(isErrorSpan(ended(Exit.void))).toBe(false);
    expect(isErrorSpan(startSpan("open"))).toBe(false);
  });
});

describe("flushSpans for an unsampled request", () => {
  it.effect(
    "exports nothing and empties the buffer when every span is ok, so a sampled-out request costs no export",
    () =>
      Effect.gen(function* () {
        const { bodies, fetchFn } = stubFetch();
        const buffer = makeSpanBuffer();
        okSpan("a", buffer);
        okSpan("b", buffer);
        buffer.dropped = 2;

        yield* flushSpans(config, buffer, fetchFn, false);

        expect(bodies).toHaveLength(0);
        expect(buffer.spans).toHaveLength(0);
        expect(buffer.dropped).toBe(0);
      }),
  );

  it.effect("exports every span when one failed, so the trace of a failed request is whole", () =>
    Effect.gen(function* () {
      const { bodies, fetchFn } = stubFetch();
      const buffer = makeSpanBuffer();
      okSpan("fine", buffer);
      failedSpan("broken", buffer);

      yield* flushSpans(config, buffer, fetchFn, false);

      expect(exportedNames(bodies[0])).toEqual(["fine", "broken"]);
    }),
  );

  it.effect("exports when a span answered 500, so a caught server error is still traced", () =>
    Effect.gen(function* () {
      const { bodies, fetchFn } = stubFetch();
      const buffer = makeSpanBuffer();
      okSpan("fine", buffer);
      answeredSpan("http.request", buffer, 500);

      yield* flushSpans(config, buffer, fetchFn, false);

      expect(exportedNames(bodies[0])).toEqual(["fine", "http.request"]);
    }),
  );
});

describe("flushSpans for a sampled request", () => {
  it.effect("exports ok spans as before, so sampling in does not lose a healthy trace", () =>
    Effect.gen(function* () {
      const { bodies, fetchFn } = stubFetch();
      const buffer = makeSpanBuffer();
      okSpan("fine", buffer);

      yield* flushSpans(config, buffer, fetchFn, true);

      expect(exportedNames(bodies[0])).toEqual(["fine"]);
    }),
  );
});

describe("TracingLayer with a sampling decision", () => {
  const request = (traces: boolean): RequestContext => ({
    requestId: "req-1",
    method: "GET",
    path: "/",
    sampling: { logs: true, traces },
  });

  const runOnce = async (traces: boolean, program: Effect.Effect<unknown, unknown>) => {
    const { bodies, fetchFn } = stubFetch();
    const runtime = ManagedRuntime.make(
      TracingLayer(
        { OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" },
        fetchFn,
        request(traces),
      ),
    );
    await runtime.runPromiseExit(program);
    await runtime.dispose();
    return bodies;
  };

  it("passes the request's trace decision to the flush, so an unsampled request exports only when it fails", async () => {
    const ok = Effect.void.pipe(Effect.withSpan("work"));
    const failing = Effect.fail("boom").pipe(Effect.withSpan("work"));

    expect(await runOnce(false, ok)).toHaveLength(0);
    expect(await runOnce(true, ok)).toHaveLength(1);
    expect(await runOnce(false, failing)).toHaveLength(1);
  });
});

describe("flushSpans, forced exports under an outage", () => {
  it.effect(
    "stops exporting failed unsampled requests once the isolate's budget is spent, so an outage cannot send one export per request",
    () =>
      Effect.gen(function* () {
        const { bodies, fetchFn } = stubFetch();
        const budget = makeReportBudget({ limit: 1, windowMs: 60_000 });
        const failedRequest = () => {
          const buffer = makeSpanBuffer();
          startSpan("failed", buffer).end(200n, Exit.fail("boom"));
          return buffer;
        };

        yield* flushSpans(config, failedRequest(), fetchFn, false, budget);
        yield* flushSpans(config, failedRequest(), fetchFn, false, budget);
        yield* flushSpans(config, failedRequest(), fetchFn, true, budget);

        expect(bodies).toHaveLength(2);
      }),
  );
});
