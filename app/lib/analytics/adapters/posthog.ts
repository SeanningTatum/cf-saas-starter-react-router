import { Effect } from "effect";
import type { AnalyticsAdapter } from "../adapter";
import { AnalyticsDeliveryError } from "@/models/errors/analytics";

export const posthogAdapter = (config: {
  readonly apiKey: string;
  readonly host?: string;
}): AnalyticsAdapter => ({
  name: "posthog",
  send: (batch) =>
    Effect.tryPromise({
      try: () =>
        fetch(`${config.host ?? "https://us.i.posthog.com"}/batch/`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            api_key: config.apiKey,
            batch: batch.map((e) => ({
              event: e.event,
              distinct_id: e.distinctId,
              properties: e.properties,
              timestamp: e.timestamp,
            })),
          }),
        }),
      catch: (cause) => new AnalyticsDeliveryError({ provider: "posthog", cause }),
    }).pipe(
      Effect.filterOrFail(
        (res) => res.ok,
        (res) =>
          new AnalyticsDeliveryError({ provider: "posthog", status: res.status })
      ),
      Effect.asVoid
    ),
});
