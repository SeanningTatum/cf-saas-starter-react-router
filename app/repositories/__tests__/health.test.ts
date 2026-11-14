import { describe, expect, vi } from "vitest";
import { it } from "@effect/vitest";
import { Clock, Effect, Exit, Layer } from "effect";
import { HealthRepository } from "../health";
import { makeTestDatabase } from "@/services/database.test-layer";

const provideStub = (stub: unknown) =>
  HealthRepository.Default.pipe(Layer.provide(makeTestDatabase(stub)));

describe("HealthRepository.pingDatabase", () => {
  it.effect("returns ok: true when the database answers", () => {
    const run = vi.fn(() => Promise.resolve({ success: true, results: [] }));
    return Effect.gen(function* () {
      const repo = yield* HealthRepository;
      const result = yield* repo.pingDatabase();
      expect(result.ok).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(run).toHaveBeenCalledTimes(1);
    }).pipe(Effect.provide(provideStub({ run })));
  });

  it.effect("returns ok: false with the QueryError tag when the query rejects", () => {
    const run = vi.fn(() => Promise.reject(new Error("D1_ERROR: unavailable")));
    return Effect.gen(function* () {
      const repo = yield* HealthRepository;
      const exit = yield* Effect.exit(repo.pingDatabase());
      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) {
        expect(exit.value.ok).toBe(false);
        expect(exit.value.error).toBe("QueryError");
        expect(exit.value.latencyMs).toBeGreaterThanOrEqual(0);
      }
    }).pipe(Effect.provide(provideStub({ run })));
  });

  it.effect("returns ok: false when the driver throws synchronously", () => {
    const run = () => {
      throw new Error("boom");
    };
    return Effect.gen(function* () {
      const repo = yield* HealthRepository;
      const result = yield* repo.pingDatabase();
      expect(result).toMatchObject({ ok: false, error: "QueryError" });
    }).pipe(Effect.provide(provideStub({ run })));
  });

  it.effect("measures the query's own duration, in milliseconds", () => {
    // Catches: timing outside the query (always ~0), reporting seconds or
    // nanoseconds instead of ms. The clock's monotonic time moves only while
    // the stub query runs, so the expected latency is exact.
    let nanos = 0n;
    const clock = Clock.make();
    clock.unsafeCurrentTimeNanos = () => nanos;
    const run = () => {
      nanos += 25_000_000n;
      return Promise.resolve({ success: true });
    };
    return Effect.gen(function* () {
      const repo = yield* HealthRepository;
      const result = yield* repo.pingDatabase().pipe(Effect.withClock(clock));
      expect(result).toEqual({ ok: true, latencyMs: 25 });
    }).pipe(Effect.provide(provideStub({ run })));
  });
});
