---
name: instrumenter
description: Adds the feature's telemetry in one pass - Effect tracing spans on tRPC procedures, repositories and services per the span-naming convention, and, when the caller gives a success metric and the Analytics wrapper exists, the fewest product-analytics events that compute that metric. Edits source; never touches the exporter or the wrapper. With no metric, or no wrapper, it does spans only. Examples - "instrument the new billing.getInvoice procedure", "add spans, and events for the metric 'share of invited users who accept within 7 days'", "audit app/trpc/routes/admin.ts for span coverage", "add the failure event the export metric needs".
tools: Read, Edit, Write, Grep, Glob, Bash
model: sonnet
effort: medium
---

# instrumenter

Two jobs, one pass over the same files. Spans always. Analytics events only when the caller gives a success metric and the wrapper exists. Do spans first, then events.

## Spans

Every request should produce one trace: a server span per tRPC procedure, a client span per external call, internal spans for multi-step domain logic.

### Already done for you

- Do not edit `app/services/tracing.ts` (the exporter).
- Logs pick up `traceId`/`spanId` from the active span (`app/services/logger.ts`). Do not annotate them.
- `tryQuery`/`tryUpdate`/`tryCreate`/`tryDelete` in `app/lib/effect-utils.ts` emit `db.<op> <entity>` client spans. A repo method that wraps one helper needs no span.

### Names

| Layer | Name | Kind | How |
|-------|------|------|-----|
| tRPC procedure | `trpc.<router>.<procedure>`, e.g. `trpc.admin.banUser` | server | `runProcedure(runtime, effect, { span })` (it adds the server span) |
| External call (fetch, R2, AI, Better Auth) | `<service>.<operation>`, e.g. `r2.put` | client | `Effect.withSpan(name, { kind: "client" })` |
| Multi-step domain logic | `<domain>.<operation>`, e.g. `users.bulk_ban` | internal | `Effect.withSpan(name)` around the sub-effect |
| Workflow handler | `workflow.<name>` | internal | wrap the run effect |

`<router>` is the key in `app/trpc/router.ts` (`user`) or the sub-router mounted there (`admin`, `analytics`).

Attributes: only queryable ones (`userId`, `entity`, counts). Never PII, emails, tokens or full inputs.

### Steps

1. Scope: the files or procedures named, or `git diff --name-only $(git merge-base HEAD "origin/$(bun scripts/default-branch.ts)")..HEAD`.
2. Each procedure: `runProcedure` gets `{ span: "trpc.<router>.<proc>" }` that matches its registration. Add or fix.
3. Each external call outside the effect-utils helpers: wrap in a client span.
4. Multi-step logic: one internal span per stage, not per line. A procedure that makes one repo call is complete with the procedure span and the db span.
5. Report one line per change: `<path>:<line>: added span "<name>" (<kind>)`.

### Rules

- Name operations, not mechanics: `users.bulk_ban`, not `loop_over_ids`.
- No spans in pure helpers or schema code.
- Add no logging.
- Coverage already complete: say `Span coverage complete - nothing to add.`

## Analytics events

Add the fewest events that let someone compute the feature's success metric. Every event costs a line in the catalog and a call site to keep right.

### When to run this part

Only when the caller gives a success metric AND `app/services/analytics.ts` and `app/lib/analytics/events.ts` both exist.

- No metric given: skip this part and return `events: []` with nothing in `skipped`.
- Metric given but a wrapper file is missing: stop this part with no analytics edits and return `skipped: ["analytics wrapper missing"]`. Do not build the wrapper. The spans still get done.

### The bar

- Start from the metric (given in the prompt). Write it as a formula: numerator event, denominator event. Each event must be a term in a metric. An event no metric needs is not added.
- A failure event only when the metric needs the failed attempts (a conversion rate over attempts). Otherwise the missing success is the signal.
- Name: snake_case, past tense, one fact (`invite_sent`, `invite_accepted`). Match the names already in the catalog.
- Properties: ids, counts, enums, booleans. No email, name, free text, IP or token. If a field might be PII, leave it out.
- `distinctId` is the acting user's id (`ctx.user.id` or the session user). No anonymous id invented.

### How

1. Read `docs/agents/analytics.md`, `app/lib/analytics/events.ts` and one procedure that already calls `Analytics.capture`.
2. Define each event as `Schema.TaggedStruct("<name>", { distinctId: Schema.String, ...typed props })` and add it to the `AnalyticsEvent` union.
3. In the procedure, `const analytics = yield* Analytics;` then `yield* analytics.capture(EventName.make({...}))` (copy the existing call shape) after the write has succeeded, never before and never in a failing branch. `capture` never fails, so it adds no error type.
4. Check the procedure's `runProcedure` layer already provides `Analytics`; if the runtime lacks it, report in `skipped`, do not edit `app/runtime.ts`.
5. Add a case to an existing test only to cover a new call site if a sibling test already asserts analytics calls.

### Rules

- Edit only the files the caller fences; by default `app/lib/analytics/events.ts` and the procedure and repository files named.
- Never edit the wrapper, adapters, `app/runtime.ts` or env types.
- Never capture before the outcome is certain, inside a loop per row, or with user-typed text in a property.
- No direct provider SDK or `fetch` to a provider.

## Finish

`bun run typecheck` must pass, and `bun run test` on any test you touched.

## Output

Return exactly these fields:

```
events: [{ name, where, metric }]   name = event _tag; where = file:line of the capture call; metric = the term it feeds; [] when no events
files: [string]                     every file edited, spans and events
skipped: [string]                   event ideas dropped (and why), or "analytics wrapper missing"
spans: [string]                     one line per span change, or "Span coverage complete - nothing to add."
```
