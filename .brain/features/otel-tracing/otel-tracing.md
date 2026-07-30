# Feature: OpenTelemetry Span Tracing

_Last updated: 2026-07-29_

## Purpose
Effect span tracing across tRPC procedures, repositories, and services, exported as OTLP JSON to an env-configured collector endpoint. Gives local and deployed agents a real trace of a request's path through the system (procedure → service → repository) instead of relying on scattered logs, and correlates every log line with the trace/span that produced it.

## When It's Used
- Every tRPC procedure invocation (via `runProcedure`) — root span per request
- Every repository method and service call nested under the request span
- Local/deployed debugging sessions where an agent needs to inspect request flow via MCP-based trace tooling
- Complete no-op (zero overhead, no network calls) when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset — safe default for dev/CI/preview environments that haven't configured a collector

## How It Works
- `TracingLayer(env)` (`app/services/tracing.ts`) is merged into the app runtime in `app/runtime.ts` alongside `LoggerLive`. When `OTEL_EXPORTER_OTLP_ENDPOINT` is unset it returns `Layer.empty` — Effect's built-in tracer still creates in-memory spans, so log correlation works with zero export cost. When set, it installs a custom `Tracer` (`Layer.setTracer`) whose `OtlpSpan`s push into a per-request buffer on `end()` (capped at `MAX_BUFFERED_SPANS = 1000`; overflow counted as dropped), plus a scope finalizer that drains the buffer into one OTLP/HTTP JSON POST. The finalizer runs on `runtime.dispose()`, which `workers/app.ts` already wraps in `ctx.waitUntil` — export never blocks the response. Export failures log `tracing.export_failed` and are swallowed.
- No OTel SDK dependency — the OTLP JSON encoding (`buildOtlpPayload`, `toOtlpValue`, kind/status mapping) is hand-rolled and unit-tested; Workers-safe (fetch + crypto only).
- Root spans: `runProcedure(runtime, effect, { span: "trpc.<router>.<procedure>" })` wraps the procedure in a server-kind span; all 15 existing procedures pass it (`app/trpc/router.ts`, `routes/admin.ts`, `routes/analytics.ts`; the shared `runBulkUserAction` helper takes a `span` param).
- DB spans: `tryQuery`/`tryUpdate`/`tryCreate`/`tryDelete` in `app/lib/effect-utils.ts` emit `db.<op> <entity>` client spans, so every repository query is traced with no repo edits.
- Log correlation: `LoggerLive`'s custom logger calls `currentSpanAnnotations(context)` (exported from `app/services/logger.ts`) — reads `Tracer.ParentSpan` off the log event's fiber context and injects `traceId`/`spanId` into every log's annotations.
- Going forward: the `span-instrumenter` sub-agent (`.claude/agents/span-instrumenter.md`) audits/adds spans after any endpoint/service change; the convention + agent MCP debugging recipe live in `codebase/observability.md`.

### Persistence details
- No persistent storage owned by this feature — spans are exported out-of-process to the configured OTLP endpoint; nothing is written to D1/R2/KV.
- Env vars: `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME` (all optional; feature is inert without the endpoint).

### Testability
All exports of `tracing.ts` are pure or take injected dependencies (`fetchFn` param on `flushSpans`/`TracingLayer`), so the no-op path, header parsing, OTLP payload shape, buffer cap, flush-on-dispose, and export-failure swallowing are unit-testable without a collector. `currentSpanAnnotations` is exported for direct testing with captured `FiberRefs`. Tests in `app/services/__tests__/tracing.test.ts` + extensions to `logger.test.ts`, `effect-utils.test.ts`, `effect-trpc.test.ts`.

## Key Files

| File | Role |
|------|------|
| `app/services/tracing.ts` | Custom Effect `Tracer` + OTLP JSON export via fetch (`TracingLayer`, `flushSpans`, `buildOtlpPayload`) |
| `app/runtime.ts` | Merges `TracingLayer(env)` into the request-scoped runtime |
| `app/services/logger.ts` | `currentSpanAnnotations` — every log auto-carries traceId/spanId |
| `app/lib/effect-trpc.ts` | `runProcedure` optional `{ span }` third arg (server-kind root span) |
| `app/lib/effect-utils.ts` | `db.<op> <entity>` client spans on the four DB helpers |
| `.claude/agents/span-instrumenter.md` | Sub-agent that audits/adds spans on new code |
| `../../codebase/observability.md` | Canonical doc — architecture, naming, MCP debugging recipe |
| `.dev.vars.example` | Commented OTEL_* local config |

## Dependencies
- Effect services consumed: `CloudflareEnv` (env vars), `Logger`
- tRPC `runProcedure` (root span attachment point)
- Repository / service layers (nested spans)

## Tagged Errors
None expected to be user-facing; tracer export failures should be swallowed/logged internally rather than surfaced as request errors (tracing must never break the request path).

| Error | Where raised | tRPC code |
|-------|--------------|-----------|
| n/a | n/a | n/a |

## Changelog

| Date | Type | Description |
|------|------|-------------|
| 2026-07-29 | feature | Kickoff — scoped and marked in-progress. Baseline green (typecheck PASS, test PASS, harness-check PASS). |
| 2026-07-29 | feature | **Shipped.** verify-done full pass (typecheck, 301/301 tests, e2e 2/2, build, enforcer 0 findings, harness 10/10). Live OTLP trace captured from dev server — see `verifications/2026-07-29.md`. |
