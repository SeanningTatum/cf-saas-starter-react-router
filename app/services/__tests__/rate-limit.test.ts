import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Either, Layer, Logger, LogLevel } from "effect";
import { RateLimiter, RateLimiterLive, type RateLimitRule } from "../rate-limit";
import { CloudflareEnv } from "../cloudflare";
import { RateLimitError } from "@/models/errors/rate-limit";
import {
  RATE_LIMIT_BINDINGS,
  RATE_LIMIT_PERIOD_SECONDS,
  RATE_LIMITER_FAULT_MESSAGE,
} from "@/lib/constants/rate-limit";

const LIMIT = 2;

const countingLimiter = (limit: number): RateLimit & { readonly calls: string[] } => {
  const counts = new Map<string, number>();
  const calls: string[] = [];
  return {
    calls,
    limit: async ({ key }) => {
      calls.push(key);
      const used = counts.get(key) ?? 0;
      counts.set(key, used + 1);
      return { success: used < limit };
    },
  };
};

const rejectingLimiter: RateLimit = {
  limit: () => Promise.reject(new Error("limiter down")),
};

interface LogLine {
  readonly level: string;
  readonly message: unknown;
}

const runCheck = (env: Partial<Env>, checks: ReadonlyArray<[RateLimitRule, string]>) => {
  const logs: LogLine[] = [];
  const captureLogs = Logger.replace(
    Logger.defaultLogger,
    Logger.make(({ logLevel, message }) => {
      logs.push({ level: logLevel.label, message });
    }),
  );
  const layer = RateLimiterLive.pipe(
    Layer.provide(Layer.succeed(CloudflareEnv, env as Env)),
    Layer.merge(captureLogs),
  );
  return Effect.gen(function* () {
    const limiter = yield* RateLimiter;
    const results = yield* Effect.forEach(checks, ([rule, key]) =>
      Effect.either(limiter.check(rule, key)),
    );
    return { results, logs };
  }).pipe(Effect.provide(layer), Logger.withMinimumLogLevel(LogLevel.All));
};

describe("RateLimiterLive", () => {
  it.effect("lets requests through up to the binding's limit", () =>
    Effect.gen(function* () {
      const binding = countingLimiter(LIMIT);
      const { results } = yield* runCheck({ [RATE_LIMIT_BINDINGS.signIn]: binding }, [
        ["signIn", "203.0.113.1"],
        ["signIn", "203.0.113.1"],
      ]);
      expect(results.every(Either.isRight)).toBe(true);
      expect(binding.calls).toEqual(["203.0.113.1", "203.0.113.1"]);
    }),
  );

  it.effect("fails with RateLimitError naming the rule and the wait once the binding says no", () =>
    Effect.gen(function* () {
      const binding = countingLimiter(LIMIT);
      const { results } = yield* runCheck({ [RATE_LIMIT_BINDINGS.signUp]: binding }, [
        ["signUp", "203.0.113.2"],
        ["signUp", "203.0.113.2"],
        ["signUp", "203.0.113.2"],
      ]);
      const last = results[LIMIT];
      expect(last && Either.isLeft(last)).toBe(true);
      if (last && Either.isLeft(last)) {
        expect(last.left).toBeInstanceOf(RateLimitError);
        expect(last.left).toMatchObject({
          rule: "signUp",
          retryAfterSeconds: RATE_LIMIT_PERIOD_SECONDS,
        });
      }
    }),
  );

  it.effect(
    "counts each key on its own, so one caller over the limit does not lock out another",
    () =>
      Effect.gen(function* () {
        const binding = countingLimiter(1);
        const { results } = yield* runCheck({ [RATE_LIMIT_BINDINGS.upload]: binding }, [
          ["upload", "user-a"],
          ["upload", "user-a"],
          ["upload", "user-b"],
        ]);
        expect(results.map(Either.isRight)).toEqual([true, false, true]);
      }),
  );

  it.effect("asks the binding of the rule it was given, not another rule's", () =>
    Effect.gen(function* () {
      const signIn = countingLimiter(LIMIT);
      const authApi = countingLimiter(LIMIT);
      yield* runCheck(
        { [RATE_LIMIT_BINDINGS.signIn]: signIn, [RATE_LIMIT_BINDINGS.authApi]: authApi },
        [["authApi", "203.0.113.3"]],
      );
      expect(signIn.calls).toEqual([]);
      expect(authApi.calls).toEqual(["203.0.113.3"]);
    }),
  );

  it.effect("lets the request through and logs an error when the binding is missing", () =>
    Effect.gen(function* () {
      const { results, logs } = yield* runCheck({}, [["signIn", "203.0.113.4"]]);
      expect(results.every(Either.isRight)).toBe(true);
      expect(logs).toContainEqual(
        expect.objectContaining({
          level: "ERROR",
          message: expect.arrayContaining([RATE_LIMITER_FAULT_MESSAGE]),
        }),
      );
    }),
  );

  it.effect("lets the request through and logs an error when the binding call rejects", () =>
    Effect.gen(function* () {
      const { results, logs } = yield* runCheck(
        { [RATE_LIMIT_BINDINGS.signIn]: rejectingLimiter },
        [["signIn", "203.0.113.5"]],
      );
      expect(results.every(Either.isRight)).toBe(true);
      expect(logs.filter((line) => line.level === "ERROR")).toHaveLength(1);
    }),
  );
});
