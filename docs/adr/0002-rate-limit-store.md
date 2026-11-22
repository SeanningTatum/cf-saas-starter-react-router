---
status: proposed
date: 2026-11-22
---

# The Workers Rate Limiting binding is the store for rate limits, behind the `RateLimiter` service

Rate limits on sign-in, sign-up, the rest of the auth API and uploads count in Cloudflare's Workers Rate Limiting binding. Code reaches it only through `RateLimiter` (`app/services/rate-limit.ts`). Better Auth's own limiter is off.

## Context

Better Auth's default limiter counts in memory, in each isolate. On Workers, requests from one caller land on many isolates, and an isolate can start or stop at any time, so each isolate counts a part of the traffic and the limit does not hold. Ticket #80 needs a store that every isolate shares. The rules and how to use them: [`docs/auth.md`](../auth.md#rate-limits).

## Options

| | Correct across isolates | Cost | Local dev and the e2e gate | What it adds to run |
|---|---|---|---|---|
| **Workers Rate Limiting binding (chosen)** | Shared by every isolate in one location. Per location and approximate. | None. No round trip: the count is cached locally. | Miniflare simulates it in `react-router dev` and in `getPlatformProxy`. The unit harness and the e2e gate both run on the simulation (checked). | A `ratelimits` entry per rule. No table, nothing to create in Cloudflare. Period is 10 or 60 s only, and limits are fixed in config. |
| KV | No. Eventually consistent, no atomic increment. | Write limits per key. | Simulated. | A namespace. Wrong tool for a counter. |
| D1 | Yes, exact and global, any window. | One write per anonymous attempt on the single-writer primary: the limiter would load the database it should shield. | Already bound and simulated. | A table, a prune job and a migration. |
| Durable Object | Yes, exact and global, any window. | Billed requests and duration, per key. | More to run locally. | A class and a migration. |

## Decision

Use the Workers Rate Limiting binding, one binding per rule, behind the `RateLimiter` service. The count is approximate and per location. We take that: the limits stop a script that hammers a form, and they are not a billing quota.

Two smaller choices go with it:

- **The check runs at the route, before Better Auth.** `app/routes/api/auth.$.ts` calls the gate and hands the request on only if it passes. A limited request never reaches Better Auth or Turnstile, so it costs no `siteverify` call.- **A limiter fault fails open.** If the binding is missing or throws, the request goes on and the fault is logged. A fault in the limiter must not lock every user out of sign-in. The cost: while the fault lasts, there is no limit. Turnstile still applies.

## Consequences

- A fork gives up exact global counts and windows longer than a minute. There is no hourly cap and no lockout.
- A limit is a number in config: `wrangler.jsonc`, mirrored in `scripts/lib/wrangler-config.ts` and checked by `scripts/__tests__/wrangler-config.test.ts`. Changing one needs a deploy, not a code path.
- Many users behind one address share one count.
- Nothing to create or migrate. The namespace ids are numbers the owner picks.
- **To move** to exact counts: write a Durable Object layer that provides `RateLimiter` and swap it for `RateLimiterLive` in `app/runtime.ts`. The call sites (`guardAuthRequest`, the upload route) and their tests do not change.

## When to look again

- A need for exact counts, such as a paid quota or a per-account cap.
- A need for a long lockout (after five failures, wait an hour).
- A fault log shows the limiter failing often enough that open is not safe.
