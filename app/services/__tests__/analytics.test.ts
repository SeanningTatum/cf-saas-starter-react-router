import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Exit, TestClock } from "effect";
import { Analytics, AnalyticsFrom, selectAdapter } from "../analytics";
import { noopAdapter } from "@/lib/analytics/adapters/noop";
import { consoleAdapter } from "@/lib/analytics/adapters/console";
import type { AnalyticsAdapter, CapturedEvent } from "@/lib/analytics/adapter";
import { AnalyticsDeliveryError } from "@/models/errors/analytics";

const banned = {
  _tag: "user_banned",
  distinctId: "admin-1",
  targetUserId: "u-9",
  hasReason: true,
  hasExpiry: false,
} as const;

describe("Analytics service", () => {
  const recording = () => {
    const batches: Array<ReadonlyArray<CapturedEvent>> = [];
    const adapter: AnalyticsAdapter = {
      name: "rec",
      send: (b) => Effect.sync(() => void batches.push(b)),
    };
    return { batches, adapter };
  };

  it.effect("buffers captures and flushes them as one batch when the scope closes, with the injected clock", () =>
    Effect.gen(function* () {
      // Catches: one request per event, flushing before dispose (adds
      // latency), never flushing, and Date.now() instead of the Clock.
      const { batches, adapter } = recording();
      yield* TestClock.setTime(Date.parse("2026-03-04T05:06:07.000Z"));
      yield* Effect.scoped(
        Effect.gen(function* () {
          const a = yield* Analytics;
          yield* a.capture(banned);
          yield* a.identify("admin-1", { plan: "pro" });
          expect(batches).toHaveLength(0);
        }).pipe(Effect.provide(AnalyticsFrom(adapter)))
      );
      expect(batches).toHaveLength(1);
      expect(batches[0].map((e) => e.event)).toEqual(["user_banned", "$identify"]);
      expect(batches[0][0].timestamp).toBe("2026-03-04T05:06:07.000Z");
      expect(batches[0][1].properties).toEqual({ $set: { plan: "pro" } });
    })
  );

  it.effect("sends nothing when no event was captured", () =>
    Effect.gen(function* () {
      // Catches: an empty POST per request to the provider.
      const { batches, adapter } = recording();
      yield* Effect.scoped(
        Analytics.pipe(Effect.provide(AnalyticsFrom(adapter)))
      );
      expect(batches).toHaveLength(0);
    })
  );

  it.effect("swallows a delivery failure or an adapter defect: the scope still closes cleanly", () =>
    Effect.gen(function* () {
      // Catches: a provider outage failing the request or the dispose.
      for (const send of [
        () => Effect.fail(new AnalyticsDeliveryError({ provider: "bad", status: 500 })),
        () => Effect.die("boom"),
      ]) {
        const exit = yield* Effect.exit(
          Effect.scoped(
            Effect.gen(function* () {
              yield* (yield* Analytics).capture(banned);
            }).pipe(Effect.provide(AnalyticsFrom({ name: "bad", send })))
          )
        );
        expect(Exit.isSuccess(exit)).toBe(true);
      }
    })
  );
});

describe("selectAdapter", () => {
  it("picks the adapter named by ANALYTICS_PROVIDER; unset, or posthog without a key, is a no-op", () => {
    // Catches: a missing provider breaking requests, or posthog posting with
    // an undefined api_key.
    expect(selectAdapter({})).toBe(noopAdapter);
    expect(selectAdapter({ ANALYTICS_PROVIDER: "posthog" })).toBe(noopAdapter);
    expect(selectAdapter({ ANALYTICS_PROVIDER: "console" })).toBe(consoleAdapter);
    expect(
      selectAdapter({ ANALYTICS_PROVIDER: "posthog", POSTHOG_API_KEY: "k" }).name
    ).toBe("posthog");
  });
});
