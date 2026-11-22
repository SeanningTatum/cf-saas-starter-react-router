import { Clock, Context, Effect, Layer } from "effect";
import { CloudflareEnv } from "./cloudflare";
import type { AnalyticsAdapter, CapturedEvent } from "@/lib/analytics/adapter";
import type { AnalyticsEvent } from "@/lib/analytics/events";
import { noopAdapter } from "@/lib/analytics/adapters/noop";
import { consoleAdapter } from "@/lib/analytics/adapters/console";
import { posthogAdapter } from "@/lib/analytics/adapters/posthog";
import { loggers } from "@/lib/logger";

export interface AnalyticsShape {
  readonly capture: (event: AnalyticsEvent) => Effect.Effect<void>;
  readonly identify: (
    distinctId: string,
    traits: Record<string, unknown>
  ) => Effect.Effect<void>;
}

export class Analytics extends Context.Tag("app/Analytics")<
  Analytics,
  AnalyticsShape
>() {}

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
