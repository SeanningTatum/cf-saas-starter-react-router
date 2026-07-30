# Observability — structured logs + tracing spans

> Goal: any engineer **or agent** can debug a failing request in under a minute — one traceId links the procedure span, every DB span, and every log line it produced.

## Architecture

```
Effect.withSpan(...)                    Effect.logInfo / loggers.X
        │                                        │
   custom Tracer ── OtlpSpan buffer         LoggerLive (emitLog)
        │  (app/services/tracing.ts)             │  auto-annotates traceId/spanId
        │                                        │  from the active span
   runtime.dispose() finalizer              JSON lines (prod) / pretty (dev)
        │
   one OTLP/HTTP POST → $OTEL_EXPORTER_OTLP_ENDPOINT/v1/traces
   (inside ctx.waitUntil — never blocks the response)
```

- **Export is env-driven and optional.** `OTEL_EXPORTER_OTLP_ENDPOINT` unset → `TracingLayer` is `Layer.empty`, zero overhead beyond Effect's built-in tracer. Spans still exist in memory, so **log↔trace correlation works even without an exporter**.
- **Backend-agnostic**: any OTLP collector — Jaeger, Grafana Tempo, Honeycomb, Axiom, Logfire, otel-tui.
- Buffer capped at `MAX_BUFFERED_SPANS` (1000) per request; overflow counted and logged as `tracing.spans_dropped`.
- Export failures log `tracing.export_failed` and are swallowed — tracing never fails the app.

## Env vars (secrets — `wrangler secret put`, or `.dev.vars` locally)

| Var | Meaning | Example |
|-----|---------|---------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP base URL (`/v1/traces` appended if missing) | `http://localhost:4318` |
| `OTEL_EXPORTER_OTLP_HEADERS` | W3C list, values may be percent-encoded | `Authorization=Bearer%20<token>` |
| `OTEL_SERVICE_NAME` | resource `service.name` | `cf-saas-starter` (default) |

## Span-naming convention (enforced by `span-instrumenter` sub-agent)

| Layer | Name | Kind | Where |
|-------|------|------|-------|
| tRPC procedure | `trpc.<router>.<procedure>` | server | `runProcedure(runtime, effect, { span: "trpc.admin.banUser" })` — **every procedure passes this** |
| DB access | `db.<op> <entity>` | client | automatic via `tryQuery`/`tryUpdate`/`tryCreate`/`tryDelete` (`app/lib/effect-utils.ts`) — never duplicate |
| External call (R2, AI, Better Auth, fetch) | `<service>.<operation>` | client | `Effect.withSpan("r2.put", { kind: "client" })` |
| Multi-step domain logic | `<domain>.<operation>` | internal | `Effect.withSpan("users.filter_protected")` |
| Workflow handler | `workflow.<name>` | internal | wrap the run effect |

Attribute rules: only queryable dimensions (ids, entities, counts). **No PII, no emails, no tokens, no raw inputs.**

## Log correlation

`LoggerLive` (`app/services/logger.ts`) reads the active span off each log event's fiber context and injects `traceId` + `spanId` into the annotations — nothing to do manually. In dev the pretty format shows it as `(<traceId>)`; in prod it's a JSON field. Imperative `loggers.X` calls outside Effect have no span context — that's expected; they're boundary logs.

## Local dev — see traces in <1 min

```bash
# Option A: otel-tui (terminal, zero config)
brew install ymtdzzz/tap/otel-tui && otel-tui        # listens on :4318

# Option B: Jaeger UI
docker run --rm -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one

# then:
echo 'OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318' >> .dev.vars
bun run dev
```

## Agent debugging via MCP

The point of the generic-OTLP choice: whichever backend the deployment uses, the local agent queries traces through that backend's MCP server instead of tailing logs.

| Backend | MCP | Typical agent query |
|---------|-----|--------------------|
| Logfire | `logfire-mcp` (claude.ai connector exists) | "find exceptions in trace X", arbitrary SQL over spans |
| Grafana Tempo | `grafana-mcp` | TraceQL search |
| Axiom | `axiom-mcp` | APL query over spans + logs |
| Honeycomb | `honeycomb-mcp` | trace/query API |
| CF dashboard logs only | `cloudflare-observability` MCP | Workers invocation logs (no custom spans) |

Debug recipe for an agent:
1. Get the failing request's `traceId` — from the error log line (prod JSON logs carry it) or the client-reported timestamp.
2. Query the trace via MCP → see which span failed (status code 2 + message) and its duration breakdown.
3. Query logs filtered by that `traceId` → full annotated context (`actor`, `entity`, cause chain from `tapErrorCause`).
4. Only then open code — the failing span name points at the exact procedure/repo call.

## When you add code

- New tRPC procedure → pass `{ span: "trpc.<router>.<proc>" }` to `runProcedure` (recipe `add-trpc-endpoint` step).
- New repo method → nothing, helpers cover it; add an internal span only for multi-step logic.
- New service/external client → wrap calls in `Effect.withSpan("<service>.<op>", { kind: "client" })` (recipe `add-service` step).
- After any of the above → run the `span-instrumenter` sub-agent to audit coverage before `/verify-done`.
