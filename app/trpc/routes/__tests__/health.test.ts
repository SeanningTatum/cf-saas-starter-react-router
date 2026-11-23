import { afterEach, describe, expect, it, vi } from "vitest";
import { Clock, Layer, ManagedRuntime } from "effect";
import { TRPCError } from "@trpc/server";
import { createCallerFactory, type Context } from "@/trpc";
import { appRouter } from "@/trpc/router";
import { HealthRepository } from "@/repositories/health";
import { makeTestDatabase } from "@/services/database.test-layer";
import { makeOtlpTracer, makeSpanBuffer } from "@/services/tracing";
import type { AppRuntime } from "@/runtime";

vi.mock("@/lib/log-format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log-format")>()),
  isDev: false,
}));

const CHECKED_AT = Date.UTC(2026, 10, 13, 12, 0, 0);
const QUERY_MS = 7;

const makeFrozenClock = () => {
  let nanos = 0n;
  const clock = Clock.make();
  clock.unsafeCurrentTimeMillis = () => CHECKED_AT;
  clock.unsafeCurrentTimeNanos = () => nanos;
  return {
    clock,
    advance: (ms: number) => {
      nanos += BigInt(ms) * 1_000_000n;
    },
  };
};

const runtimes: Array<{ dispose: () => Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((r) => r.dispose()));
});

const setup = (run: (advance: (ms: number) => void) => Promise<unknown>) => {
  const { clock, advance } = makeFrozenClock();
  const buffer = makeSpanBuffer();
  const runSpy = vi.fn(() => run(advance));
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      HealthRepository.Default.pipe(Layer.provide(makeTestDatabase({ run: runSpy }))),
      Layer.setTracer(makeOtlpTracer(buffer)),
      Layer.setClock(clock),
    ),
  );
  runtimes.push(runtime);
  const caller = (role: "admin" | "user" | null) =>
    createCallerFactory(appRouter)({
      headers: new Headers(),
      runtime: runtime as unknown as AppRuntime,
      auth: role === null ? null : { session: { id: "s1" }, user: { id: "u1", role } },
    } as unknown as Context);
  return { caller, runSpy, buffer };
};

describe("admin.dbHealth (reports database health as data: a failed D1 query resolves to ok: false with the error's tag and never rejects, record D1; admin-only because it exposes database latency, record D2; the clock is frozen at CHECKED_AT and moves only while the stub query runs, so latencyMs and checkedAt are exact, not ranges)", () => {
  it("returns ok with the query's latency and the check time, under the trpc.admin.dbHealth span, so timing, unit, checkedAt, the absent error key and the span name the metric reads cannot drift", async () => {
    const { caller, buffer } = setup(async (advance) => {
      advance(QUERY_MS);
      return { success: true };
    });

    const result = await caller("admin").admin.dbHealth();

    expect(result).toEqual({
      ok: true,
      latencyMs: QUERY_MS,
      checkedAt: "2026-11-13T12:00:00.000Z",
    });
    expect(result).not.toHaveProperty("error");
    const root = buffer.spans.find((s) => s.name === "trpc.admin.dbHealth");
    expect(root?.kind).toBe("server");
    expect(buffer.spans.some((s) => s.name === "db.query health")).toBe(true);
  });

  it("resolves ok: false with the QueryError tag when D1 fails, instead of rejecting, so the client shows a red status and not a 500 toast", async () => {
    const { caller } = setup(async (advance) => {
      advance(QUERY_MS);
      throw new Error("D1_ERROR: database unavailable");
    });

    await expect(caller("admin").admin.dbHealth()).resolves.toEqual({
      ok: false,
      latencyMs: QUERY_MS,
      checkedAt: "2026-11-13T12:00:00.000Z",
      error: "QueryError",
    });
  });

  it("rejects non-admins with FORBIDDEN and anonymous callers with UNAUTHORIZED, before touching D1, so database latency is not exposed to any user", async () => {
    const { caller, runSpy } = setup(async () => ({ success: true }));

    const asUser = caller("user").admin.dbHealth();
    await expect(asUser).rejects.toBeInstanceOf(TRPCError);
    await expect(asUser).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(caller(null).admin.dbHealth()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });

    expect(runSpy).not.toHaveBeenCalled();
  });
});
