# Logging and spans

Every log line goes through one sink, `emitLog` in `app/lib/log-format.ts`. Plain code calls `loggers.<layer>.info(...)` (`app/lib/logger.ts`); Effect code calls `Effect.log*` (`app/services/logger.ts`). Both end in `emitLog`, which adds the request id and user id, redacts the line, and writes it. Errors have their own path: see [error-reporting.md](error-reporting.md).

No `console` call belongs in `app/` or `workers/`. The two in `emitLog` are the sink itself and carry a `biome-ignore` line with the reason. In the browser, report a caught error with `reportHandledError(error)` from `app/lib/error-reporting/browser.ts`.

## Redaction

`emitLog` passes every line through `redactFields` (`app/lib/redact.ts`) before it writes it: the fields from the request context, the annotations and the message.

- **By key.** A value under a key that contains `authorization`, `cookie`, `token`, `password`, `passwd`, `secret`, `api_key`, `session`, `credential`, `jwt`, `otp` or `signature` (any case, anywhere in the key: `accessToken`, `set-cookie`, `client_secret`) becomes `[redacted]`, whatever it holds, at any depth. The words are one list, `SECRET_WORDS` in `app/lib/constants/redaction.ts`; the text patterns are built from the same list.
- **By content.** Every string, under any key, and every key itself, goes through `redactText`: an email address becomes `email:<16 hex characters of its SHA-256>`, and credentials in text are masked. The list of shapes and its gaps are in [error-reporting.md](error-reporting.md#redaction).
- An `Error` value is written as its name, message and stack, each redacted. A cycle is written as `[circular]`. Anything more than six levels deep (the line itself is level one) is written as `[too deep]`. A string is cut at 16,384 characters, an array or object at 100 entries, and bytes (a typed array or buffer) are written as `[binary]`.
- If a field cannot be read (a getter that throws), `emitLog` does not throw: it writes the level, the time and a fixed message, and drops the fields.

Span text is redacted on export too (`app/services/tracing-otlp.ts`): string attributes, event attributes and the status message of a failed span go through `redactText`, an attribute whose key is on the list above is masked whole, and `url.path` goes through `redactPath`. Span names are constants.

Not masked by key: an IP address or a user agent. They are personal data, not secrets; keep them out of log calls unless you need them.

The hash is unsalted SHA-256 from `@noble/hashes`, which gives the same bytes as Web Crypto (a test checks this). It is computed in the Worker without `await`, because `emitLog` is synchronous: a line that waited on `crypto.subtle.digest` could be lost when the request ends. The hash lets you find every line about one address. It does not keep the address secret from someone who has a list of addresses to try.

A key match masks too much rather than too little: `tokenCount` is masked. Name a harmless field something else.

## Sampling

Each request draws once, in `workers/app.ts`, whether to keep its logs and whether to export its spans (`decideSampling` in `app/lib/sampling.ts`). The rates come from the environment's preset (`app/lib/constants/sampling.ts`), and two vars override them.

| Environment | Logs | Traces |
|-------------|------|--------|
| `development` | 1 | 1 |
| `preview` | 1 | 1 |
| `staging` | 1 | 1 |
| `production` (and any name not listed) | 1 | 0.1 |

| Var | Meaning |
|-----|---------|
| `ENVIRONMENT` | Picks the row. Default `development` in dev, else `production`. Pass it at deploy: `wrangler deploy --var ENVIRONMENT:staging`. |
| `LOG_SAMPLE_RATE` | A number from 0 to 1. Overrides the row's log rate. Anything else is ignored. |
| `TRACE_SAMPLE_RATE` | A number from 0 to 1. Overrides the row's trace rate. Anything else is ignored. |

What a request that was not drawn still writes:

- **Logs:** every line at `warn` or above, and so every error report; and any line with the annotation `audit: true` (the admin ban, unban and role-change line in `app/trpc/routes/admin.ts` carries it). Other `info` lines and below are dropped. Mark a line `audit: true` when losing it would hide who did what.
- **Spans:** all of its spans, when one of them failed or the response was a 500 or above. A request that went well exports nothing. These forced exports share a per-isolate budget of 60 a minute, so an outage in which every request fails does not send one export per request.

The draw is random per request. It does not follow the caller's `traceparent` sampled flag: the caller is the public internet, and a caller could otherwise turn sampling off.

Workers Logs has its own head sampling (`observability.logs.head_sampling_rate` in `wrangler.jsonc`, per environment). It applies after this one, to whole invocations.

## Spans

Names are constants in `app/lib/constants/spans.ts` (tRPC span names stay beside their procedure). The convention is in `.claude/agents/instrumenter.md`.

| What | Span | Kind | Where |
|------|------|------|-------|
| The request | `http.request`, with `http.response.status_code` | server | `app/runtime.ts`, `workers/app.ts` |
| A tRPC procedure | `trpc.<router>.<procedure>` | server | `runProcedure(runtime, effect, { span })` |
| A D1 query | `db.<op> <entity>` | client | `tryQuery` and friends in `app/lib/effect-utils.ts` |
| An R2 call | `r2.put`, `r2.get`, `r2.delete`, `r2.list` | client | `app/repositories/bucket.ts` |
| A Better Auth session lookup | `auth.get_session` | client | `getSession` in `app/services/session.ts`; `SessionLive`, the upload route and the loader guards in `app/lib/session.ts` all use it |
| The upload route | `upload.store_file`, with `upload.read_head` inside | internal | `app/routes/api/upload-file.ts` |

## Gates

Two house lint rules (`bun run lint:house`; the table and how to add a rule are in [lint-rules.md](lint-rules.md)) fail the `non-negotiables` gate, each finding with its "Do this instead" line:

- `procedure-span` (`scripts/lint/rules/procedure-span.ts`): a `.query`, `.mutation` or `.subscription` in `app/trpc/routes/` that never reaches `runProcedure`, or that takes its handler by reference; a `runProcedure` call with no `span` option; a literal span name that does not start with `trpc.`.
- `external-call-span` (`scripts/lint/rules/external-call-span.ts`): an `Effect.tryPromise` in `app/repositories/`, `app/services/` or `app/lib/effect-utils.ts` that is not piped into `Effect.withSpan` (directly, through `Effect.gen(...).pipe(...)`, or through a local helper that makes the span). `app/services/tracing.ts` is a boundary in `scripts/lint/baseline.json`: the exporter cannot trace its own export.

What the gates do not see, so a reviewer still must: a procedure whose `runProcedure` call sits in dead code; a procedure built on a variable whose name does not end in `Procedure` (`const base = adminProcedure.use(mw)`); a span added in the data-first form `Effect.withSpan(effect, name)`, which the gate flags (use `.pipe`); an awaited call made through a wrapper in another file; a call that is only covered by a wide span around a whole block, not one of its own; a `tryPromise` in a small local helper whose caller adds the span (the gate flags this one: put the span in the helper). The ticket asked for "a public repository or service method without a span"; the rule checks awaited calls instead, because a method that only buffers or reads config needs no span.

The `console` ban is Biome's `noConsole` rule (issue #79), not a house rule.

## Why

- **Two ways to read the request.** `workers/app.ts` opens an async-local store around each request (`runWithRequestContext`), and plain `loggers.x.info(...)` lines read `requestId` and `userId` from it, since they take no context argument. Effect code reads the same request from the per-request runtime (`CurrentRequest`) instead.
- **`app/lib/request-context.ts` is server-only.** It imports `node:async_hooks` (a Workers API under `nodejs_compat`), so no component, no client code in `root.tsx` and not `log-format.ts` may import it. `log-format.ts` must stay free of Node imports because a client bundle may load it, so the store is handed over the other way: `request-context.ts` calls `setLogContext` when it loads, its one import-time side effect. Annotations passed to `emitLog` win over the fields from the store.
- **The request id is for finding logs and spans, nothing more.** How it is made: [request-context.md](../features/request-context.md#why). A caller chooses the `traceparent`, so no code that grants or refuses access reads the id. Test: `app/lib/__tests__/request-id-not-for-access.test.ts`.
- **Only a well-formed `cf-ray` is echoed.** Cloudflare's edge sets `cf-ray`, but a request that reaches the Worker another way (local dev, a test) can carry any value, so only `CF_RAY_SAFE_TO_ECHO_PATTERN` reaches a log line or the `x-request-id` header. Test: "falls through to a random id when cf-ray is malformed" (`app/lib/__tests__/request-context.test.ts`). A `traceparent` counts only in the W3C shape, with neither id all zeros and a version other than `ff`.
- **The user id is set once, when the session resolves.** `setRequestUser` writes it on the request and as `user.id` on the current span; it does nothing outside a request.
- **The error page reads the id from the document.** `useDocumentRequestId` (`app/lib/request-id.ts`) takes the id from context on the server and from `<html data-request-id>`, which the server wrote, in the browser. Loader data cannot do it alone: React Router skips the root loader on a 404 or 405, which is when the error page needs the id. So `useRequestId` in `app/root.tsx` takes the loader's id first (the root loader runs again on each navigation, so it is the freshest) and falls back to the document's.
- **One trace per request.** The request's part of the runtime (`requestLayer` in `app/runtime.ts`) provides `CurrentRequest` and one server span for the whole request through `Layer.span`, which sets `Tracer.ParentSpan`: every `Effect.withSpan` run through the runtime becomes its child, continuing the caller's trace when a valid `traceparent` came in, and Effect logs outside any span carry its ids. `request.id` is not set on it there: the tracer stamps it on every span, this one included, so it has one source.
- **The layers are built in an order.** The request span is built after `TracingLayer` has set the tracer, or it would go to Effect's default tracer and never be exported, and it ends before `TracingLayer`'s flush finalizer runs on `runtime.dispose()`, or it would end after the flush and be lost. `Layer.provideMerge` gives both: the provider is built first and released last. Test: "exports the request span and its child as one trace on dispose" (`app/__tests__/runtime.test.ts`). `fetchFn` is the tracing test seam.
- **Without a request the layer is `Layer<never>`.** It then holds neither service, so its type must not promise them; code that wants the request reads it with `Effect.serviceOption(CurrentRequest)`.
- **Levels are compared with the minimum as an argument.** `isLevelEnabled(level, min)` takes `min` for the reason in [trpc-dev-flag.md](../features/trpc-dev-flag.md#why): the module's `isDev` is always true under vitest.
- **In dev the request id leads the line.** The first `SHORT_REQUEST_ID_LENGTH` characters of the request id, or the trace id when there is no request, lead the line, and the leading id is left out of the trailing JSON.
- **Effect logs read the request from the fiber, never from the store.** Effect's scheduler is shared across requests, so a fiber can resume inside another request's async context; the store would then stamp the other request's ids. `currentRequestAnnotations` in `app/services/logger.ts` reads `CurrentRequest` from the fiber. Tests: "stamps the runtime's request id on a log, over the async-local store's" (`app/services/__tests__/logger.test.ts`) and "keeps two concurrent requests' ids and users on their own lines and spans" (`workers/__tests__/request-flow.test.ts`).
- **Logs carry the span's ids.** `currentSpanAnnotations` reads the active span from the fiber, so a log inside `Effect.withSpan` carries its `traceId` and `spanId`, the key that joins logs to traces.
- **Span export is off until `OTEL_EXPORTER_OTLP_ENDPOINT` is set.** Unset, `TracingLayer` is `Layer.empty`: Effect's default tracer still runs, so logs keep their trace ids, but nothing leaves the Worker. Set, the tracer buffers every ended span and one finalizer sends them as a single OTLP/HTTP JSON request when the per-request runtime is disposed. `workers/app.ts` runs that under `ctx.waitUntil`, so the export never holds up the response. Any OTLP collector works. The endpoint gets `/v1/traces` appended when it lacks it.
- **A failed export is logged and dropped.** `flushSpans` writes `tracing.export_failed` and goes on: tracing must never fail the app. The buffer holds at most `MAX_BUFFERED_SPANS`; a span past that is counted in `dropped`, not kept, and the count is logged as `tracing.spans_dropped`.
- **The `OTEL_*` vars are read off the env object, untyped.** They are optional secrets and are absent from the generated `Env` type unless the deployer sets them. `OTEL_EXPORTER_OTLP_HEADERS` uses the W3C correlation-context form, `key=value,key2=value2`, with percent-encoded values (`Authorization=Bearer%20abc`); a pair splits on its first `=`.
- **The tracer is handed the request.** `makeOtlpTracer` stamps `request.id`, and `user.id` once the session has resolved, when each span starts. It reads the same request object `setRequestUser` updates, so spans started after sign-in carry the user. The tracer's own `context` argument is `SpanOptions.context`, not the fiber's, which is why the request is passed in.
