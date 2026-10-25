import { Clock, Context, Effect, Layer } from "effect";
import { CloudflareEnv } from "./cloudflare";
import type { AnalyticsAdapter, CapturedEvent } from "@/lib/analytics/adapter";
import type { AnalyticsEvent } from "@/lib/analytics/events";
import { noopAdapter } from "@/lib/analytics/adapters/noop";
import { consoleAdapter } from "@/lib/analytics/adapters/console";
import { posthogAdapter } from "@/lib/analytics/adapters/posthog";
import { loggers } from "@/lib/logger";

export interface AnalyticsShape {
  /** Buffers the event. Never fails, never waits on the network. */
  readonly capture: (event: AnalyticsEvent) => Effect.Effect<void>;
  /** Buffers a provider-side update of a person's traits. Never fails. */
  readonly identify: (
    distinctId: string,
    traits: Record<string, unknown>
  ) => Effect.Effect<void>;
}

export class Analytics extends Context.Tag("app/Analytics")<
  Analytics,
  AnalyticsShape
>() {}

/** Unknown provider names, and `posthog` with no key, fall back to no-op so a bad config cannot break requests. */
export const selectAdapter = (env: Partial<Env>): AnalyticsAdapter => {
  switch (env.ANALYTICS_PROVIDER) {
    case "console":
      return consoleAdapter;
    case "posthog":
      return env.POSTHOG_API_KEY
        ? posthogAdapter({ apiKey: env.POSTHOG_API_KEY, host: env.POSTHOG_HOST || undefined })
        : noopAdapter;
    default:
      return noopAdapter;
  }
};

const stamp = (event: Omit<CapturedEvent, "timestamp">) =>
  Effect.map(
    Clock.currentTimeMillis,
    (ms): CapturedEvent => ({ ...event, timestamp: new Date(ms).toISOString() })
  );

/**
 * Events buffer for the life of the per-request runtime and go out as one
 * batch when it is disposed, which workers/app.ts runs under `ctx.waitUntil`.
 */
export const AnalyticsFrom = (adapter: AnalyticsAdapter) =>
  Layer.scoped(
    Analytics,
    Effect.gen(function* () {
      const buffer: CapturedEvent[] = [];

      yield* Effect.addFinalizer(() => {
        if (buffer.length === 0) return Effect.void;
        return adapter.send(buffer).pipe(
          Effect.catchAllCause((cause) =>
            Effect.sync(() =>
              loggers.server.warn(
                { provider: adapter.name, dropped: buffer.length, cause: String(cause) },
                "analytics delivery failed; batch dropped"
              )
            )
          )
        );
      });

      return {
        capture: ({ _tag, distinctId, ...properties }) =>
          Effect.map(stamp({ event: _tag, distinctId, properties }), (e) => {
            buffer.push(e);
          }),
        identify: (distinctId, traits) =>
          Effect.map(
            stamp({ event: "$identify", distinctId, properties: { $set: traits } }),
            (e) => {
              buffer.push(e);
            }
          ),
      };
    })
  );

export const AnalyticsLive = Layer.unwrapEffect(
  Effect.map(CloudflareEnv, (env) => AnalyticsFrom(selectAdapter(env)))
);
