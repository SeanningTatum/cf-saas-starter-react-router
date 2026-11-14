import { afterEach, describe, expect, it, vi } from "vitest";
import { Clock, Layer, ManagedRuntime } from "effect";
import { TRPCError } from "@trpc/server";
import { createCallerFactory, type Context } from "@/trpc";
import { appRouter } from "@/trpc/router";
import { HealthRepository } from "@/repositories/health";
import { makeTestDatabase } from "@/services/database.test-layer";
import { makeOtlpTracer, makeSpanBuffer } from "@/services/tracing";
import type { AppRuntime } from "@/runtime";

/**
 * `admin.dbHealth` reports database health as data: a failed D1 query must
 * resolve to `ok: false` with the error's tag, never reject, so a caller can
 * show a red status instead of an error toast (record D1). It is admin-only
 * (record D2): it exposes database latency.
 */

// `import.meta.env.DEV` is always true under vitest, which makes
// `timingMiddleware` sleep 100-499ms of real time per call. Turn it off so
// the tests stay fast and free of real timers.
vi.mock("@/lib/log-format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log-format")>()),
  isDev: false,
}));

const CHECKED_AT = Date.UTC(2026, 10, 13, 12, 0, 0);
const QUERY_MS = 7;

// A clock frozen at CHECKED_AT whose monotonic time only moves when the stub
// query runs, so `latencyMs` and `checkedAt` are exact, not ranges.
const makeClock = () => {
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
  const { clock, advance } = makeClock();
  const buffer = makeSpanBuffer();
  const runSpy = vi.fn(() => run(advance));
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      HealthRepository.Default.pipe(
        Layer.provide(makeTestDatabase({ run: runSpy }))
      ),
      Layer.setTracer(makeOtlpTracer(buffer)),
      Layer.setClock(clock)
    )
  );
  runtimes.push(runtime);
  const caller = (role: "admin" | "user" | null) =>
    createCallerFactory(appRouter)({
      headers: new Headers(),
      runtime: runtime as unknown as AppRuntime,
      auth:
        role === null
          ? null
          : { session: { id: "s1" }, user: { id: "u1", role } },
    } as unknown as Context);
  return { caller, runSpy, buffer };
};

describe("admin.dbHealth", () => {
  it("returns ok with the query's latency and the check time, under the trpc.admin.dbHealth span", async () => {
    // Catches: timing the wrong window or in the wrong unit, stamping
    // checkedAt from anything but the clock, leaking an `error` key on
    // success, or renaming the span the success metric is read from.
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

  it("resolves ok: false with the QueryError tag when D1 fails, instead of rejecting", async () => {
    // Catches: re-failing on `!ok` (the client would get a 500 toast, not a
    // red status) or dropping the `error` field on the way out.
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

  it("rejects non-admins with FORBIDDEN and anonymous callers with UNAUTHORIZED, before touching D1", async () => {
    // Catches: moving dbHealth to protectedProcedure or publicProcedure,
    // which would expose database latency to any user (record D2).
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
