import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `isDev` is read from `import.meta.env.DEV` when `log-format` loads, and it is
// always true under vitest. Stub it before any import so lines are the
// production JSON (the full `requestId`, not an 8-character prefix), the log
// level is Info, and the tRPC dev delay is 0.
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
import {
  makeRequestContext,
  runWithRequestContext,
  setRequestUser,
} from "@/lib/request-context";

/**
 * Ticket #74: "a test follows one request through loader, tRPC and repository
 * and finds one id on every line". The id reaches a line by two roads: plain
 * `loggers.x` lines read the async-local store `workers/app.ts` opens, and
 * spans read the request the per-request runtime was built with. Each road
 * has its own unit test; this walks the real admin dashboard loader through
 * the real router, procedures, repository and `tryQuery`, with only D1 and the
 * OTLP collector stubbed, to prove the two roads agree on one request.
 */

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

/**
 * One request as `workers/app.ts` serves it: one RequestContext, handed both
 * to the runtime and to the async-local store; the user set through the
 * runtime (as `createTRPCContext` does); then the loader. Returns the request
 * id and the spans exported when the runtime is disposed.
 */
const walk = async (headers: Record<string, string>, userId: string) => {
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
        observabilityLayer(
          { OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318" },
          ctx,
          fetchFn
        )
      )
    )
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
    (body) => JSON.parse(body).resourceSpans[0].scopeSpans[0].spans as ExportedSpan[]
  );
  return { requestId: ctx.requestId, spans };
};

describe("one request through loader, tRPC and repository", () => {
  it.each([
    ["a traceparent", { traceparent: TRACEPARENT }],
    ["a cf-ray and no traceparent", { "cf-ray": "8f1a2b3c4d5e6f70-SJC" }],
  ])("carries one id on every line and span, with %s", async (_label, headers) => {
    // Catches: a plain log line outside the async-local store (no requestId),
    // a span from a tracer that was not handed the request (no request.id), a
    // procedure or db span that does not hang off the request span (a second
    // traceId), the user set on a copy of the request (no userId/user.id
    // after sign-in), and dropping the incoming traceparent.
    const { requestId, spans } = await walk(headers, "u1");

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatchObject({ requestId, userId: "u1" });
    }
    // The four procedures each log once through the tRPC timing middleware.
    expect(lines.filter((l) => l.layer === "trpc").map((l) => l.path).sort()).toEqual([
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
      expect({ name: span.name, id: attr(span, "request.id"), user: attr(span, "user.id") })
        .toEqual({ name: span.name, id: requestId, user: "u1" });
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
  });

  it("keeps two concurrent requests' ids and users on their own lines and spans", async () => {
    // The regression that matters most: one request's id or user leaking into
    // another's logs, e.g. a module-level "current request" instead of the
    // async-local store, or a tracer that reads a shared request. The two
    // walks interleave across every await of the loader and the procedures.
    const [a, b] = await Promise.all([
      walk({ traceparent: TRACEPARENT }, "user-a"),
      walk({ "cf-ray": "8f1a2b3c4d5e6f70-SJC" }, "user-b"),
    ]);

    const linesOf = (requestId: string) => lines.filter((l) => l.requestId === requestId);
    // Every line belongs to one of the two, four procedure lines each, and
    // each id's lines carry that request's user only.
    expect(linesOf(a.requestId).length + linesOf(b.requestId).length).toBe(lines.length);
    expect(linesOf(a.requestId)).toHaveLength(4);
    expect(linesOf(b.requestId)).toHaveLength(4);
    expect(new Set(linesOf(a.requestId).map((l) => l.userId))).toEqual(new Set(["user-a"]));
    expect(new Set(linesOf(b.requestId).map((l) => l.userId))).toEqual(new Set(["user-b"]));

    for (const [walked, user] of [[a, "user-a"], [b, "user-b"]] as const) {
      expect(walked.spans.length).toBeGreaterThan(0);
      expect(new Set(walked.spans.map((s) => attr(s, "request.id")))).toEqual(
        new Set([walked.requestId])
      );
      expect(new Set(walked.spans.map((s) => attr(s, "user.id")))).toEqual(new Set([user]));
    }
    expect(a.spans[0]?.traceId).not.toBe(b.spans[0]?.traceId);
  });
});
