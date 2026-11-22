# Analytics

Procedures call `Analytics`. The service buffers events for the request and sends them as one batch when the per-request runtime is disposed (`ctx.waitUntil(runtime.dispose())` in `workers/app.ts`), so analytics adds no latency. A delivery error is logged and dropped; `capture` and `identify` never fail.

## Add an event

1. In `app/lib/analytics/events.ts`, add a `Schema.TaggedStruct`. The `_tag` is the event name: snake_case, past tense. Include `distinctId`; every other field becomes a property.
2. Add it to the `AnalyticsEvent` union in the same file.
3. In the procedure, `const analytics = yield* Analytics` and `yield* analytics.capture({ _tag: "...", distinctId, ... })`.

Example: `user_banned` in `app/trpc/routes/admin.ts`.

## Add a provider

1. Write an `AnalyticsAdapter` in `app/lib/analytics/adapters/<name>.ts`: a `name` and `send(batch)`, which fails with `AnalyticsDeliveryError`.
2. Add one `case` to `selectAdapter` in `app/services/analytics.ts`.

## Environment

| Var | Meaning |
|-----|---------|
| `ANALYTICS_PROVIDER` | `none` (default), `console` or `posthog`. |
| `POSTHOG_API_KEY` | PostHog project key. A secret: `.dev.vars` locally, `wrangler secret put` in production. With `posthog` and no key, analytics is off. |
| `POSTHOG_HOST` | Default `https://us.i.posthog.com`. |

## Why

- **A bad config turns analytics off, never the app.** `selectAdapter` falls back to the no-op adapter for an unknown `ANALYTICS_PROVIDER` and for `posthog` with no key, so a typo in the env cannot break a request.
- **`capture` and `identify` only buffer.** Neither fails nor waits on the network; the batch goes out when the per-request runtime is disposed. An `AnalyticsDeliveryError` never reaches a client: `Analytics` logs it and drops the batch.
