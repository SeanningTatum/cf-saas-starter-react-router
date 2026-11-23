import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  vi.stubEnv("DEV", false);
});

import { Layer, ManagedRuntime } from "effect";
import { loader } from "@/routes/admin/_index";
import { createCallerFactory, type Context } from "@/trpc";
import { appRouter } from "@/trpc/router";
import { observabilityLayer, type AppRuntime } from "@/runtime";
import { AnalyticsRepository } from "@/repositories/analytics";
import { chainable, makeTestDatabase } from "@/services/database.test-layer";
import type { FetchLike } from "@/services/tracing";
import { makeRequestContext, runWithRequestContext, setRequestUser } from "@/lib/request-context";

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const PARENT_SPAN_ID = "00f067aa0ba902b7";
const TRACEPARENT = `00-${TRACE_ID}-${PARENT_SPAN_ID}-01`;

interface ExportedSpan {
  readonly name: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly attributes: ReadonlyArray<{ key: string; value: { stringValue?: string } }>;
}

const attr = (span: ExportedSpan, key: string) =>
  span.attributes.find((a) => a.key === key)?.value.stringValue;

let lines: Array<Record<string, unknown>> = [];

beforeEach(() => {
  lines = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    lines.push(JSON.parse(String(line)));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(() => {
  vi.unstubAllEnvs();
});

const serveOneRequest = async (headers: Record<string, string>, userId: string) => {
  const request = new Request("https://app.test/admin", { headers });
  const ctx = makeRequestContext(request);
  const bodies: string[] = [];
  const fetchFn: FetchLike = async (_url, init) => {
    bodies.push(init.body);
    return { ok: true, status: 200 };
  };
  const row = { count: 1, name: "admin", value: 1, date: "2024-01-01" };
  const runtime = ManagedRuntime.make(
    AnalyticsRepository.Default.pipe(
      Layer.provide(makeTestDatabase({ select: () => chainable([row]) })),
      Layer.provideMerge(
        observabilityLayer({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318" }, ctx, fetchFn),
      ),
    ),
  );
  const caller = createCallerFactory(appRouter)({
    headers: request.headers,
    runtime: runtime as unknown as AppRuntime,
    auth: { session: { id: "s1" }, user: { id: userId, role: "admin" } },
  } as unknown as Context);

  await runWithRequestContext(ctx, async () => {
    await runtime.runPromise(setRequestUser(userId));
    await loader({ context: { trpc: caller } } as unknown as Parameters<typeof loader>[0]);
  });
  await runtime.dispose();

  const spans = bodies.flatMap(
    (body) => JSON.parse(body).resourceSpans[0].scopeSpans[0].spans as ExportedSpan[],
  );
  return { requestId: ctx.requestId, spans };
};

describe("one request through loader, tRPC and repository, so one id is on every line (ticket #74): plain loggers lines read the async-local store workers/app.ts opens, spans read the request the per-request runtime was built with, only D1 and the OTLP collector are stubbed, and isDev is stubbed false before any import so lines are the production JSON with the full requestId, the log level is Info and the tRPC dev delay is 0", () => {
  it.each([
    ["a traceparent", { traceparent: TRACEPARENT }],
    ["a cf-ray and no traceparent", { "cf-ray": "8f1a2b3c4d5e6f70-SJC" }],
  ])(
    "carries one id on every line and span, with %s: logs read the store, spans carry request.id and user.id in one trace, the incoming traceparent is kept, and the four procedures each log once through the tRPC timing middleware",
    async (_label, headers) => {
      const { requestId, spans } = await serveOneRequest(headers, "u1");

      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toMatchObject({ requestId, userId: "u1" });
      }
      expect(
        lines
          .filter((l) => l.layer === "trpc")
          .map((l) => l.path)
          .sort(),
      ).toEqual([
        "analytics.getRoleDistribution",
        "analytics.getUserGrowth",
        "analytics.getUserStats",
        "analytics.getVerificationDistribution",
      ]);

      const names = spans.map((s) => s.name);
      expect(names).toContain("http.request");
      expect(names.some((n) => n.startsWith("trpc.analytics."))).toBe(true);
      expect(names.some((n) => n.startsWith("db.query "))).toBe(true);
      for (const span of spans) {
        expect({
          name: span.name,
          id: attr(span, "request.id"),
          user: attr(span, "user.id"),
        }).toEqual({ name: span.name, id: requestId, user: "u1" });
      }
      const traceIds = new Set(spans.map((s) => s.traceId));
      expect(traceIds.size).toBe(1);

      const root = spans.find((s) => s.name === "http.request");
      if ("traceparent" in headers) {
        expect(requestId).toBe(TRACE_ID);
        expect([...traceIds]).toEqual([TRACE_ID]);
        expect(root?.parentSpanId).toBe(PARENT_SPAN_ID);
      } else {
        expect(requestId).toBe("8f1a2b3c4d5e6f70-SJC");
        expect(root).not.toHaveProperty("parentSpanId");
      }
    },
  );

  it("keeps two concurrent requests' ids and users on their own lines and spans, so neither leaks into the other's logs (a module-level current request or a shared-request tracer would)", async () => {
    const [a, b] = await Promise.all([
      serveOneRequest({ traceparent: TRACEPARENT }, "user-a"),
      serveOneRequest({ "cf-ray": "8f1a2b3c4d5e6f70-SJC" }, "user-b"),
    ]);

    const linesOf = (requestId: string) => lines.filter((l) => l.requestId === requestId);
    expect(linesOf(a.requestId).length + linesOf(b.requestId).length).toBe(lines.length);
    expect(linesOf(a.requestId)).toHaveLength(4);
    expect(linesOf(b.requestId)).toHaveLength(4);
    expect(new Set(linesOf(a.requestId).map((l) => l.userId))).toEqual(new Set(["user-a"]));
    expect(new Set(linesOf(b.requestId).map((l) => l.userId))).toEqual(new Set(["user-b"]));

    for (const [walked, user] of [
      [a, "user-a"],
      [b, "user-b"],
    ] as const) {
      expect(walked.spans.length).toBeGreaterThan(0);
      expect(new Set(walked.spans.map((s) => attr(s, "request.id")))).toEqual(
        new Set([walked.requestId]),
      );
      expect(new Set(walked.spans.map((s) => attr(s, "user.id")))).toEqual(new Set([user]));
    }
    expect(a.spans[0]?.traceId).not.toBe(b.spans[0]?.traceId);
  });
});
