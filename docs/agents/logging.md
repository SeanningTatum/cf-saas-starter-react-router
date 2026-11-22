# Logging and spans

Every log line goes through one sink, `emitLog` in `app/lib/log-format.ts`. Plain code calls `loggers.<layer>.info(...)` (`app/lib/logger.ts`); Effect code calls `Effect.log*` (`app/services/logger.ts`). Both end in `emitLog`, which adds the request id and user id, redacts the line, and writes it. Errors have their own path: see [error-reporting.md](error-reporting.md).

No `console` call belongs in `app/` or `workers/`. The two in `emitLog` are the sink itself and carry a `biome-ignore` line with the reason. In the browser, report a caught error with `reportHandledError(error)` from `app/lib/error-reporting/browser.ts`.

## Redaction

`emitLog` passes every line through `redactFields` (`app/lib/redact.ts`) before it writes it: the fields from the request context, the annotations and the message.

- **By key.** A value under a key that contains `authorization`, `cookie`, `token`, `password`, `passwd`, `secret`, `api_key`, `session`, `credential`, `jwt`, `otp` or `signature` (any case, anywhere in the key: `accessToken`, `set-cookie`, `client_secret`) becomes `[redacted]`, whatever it holds, at any depth. The words are one list, `SECRET_WORDS` in `app/lib/constants/redaction.ts`; the text patterns are built from the same list.
- **By content.** Every string, under any key, goes through `redactText`: an email address becomes `email:<16 hex characters of its SHA-256>`, and credentials in text are masked. The list of shapes and its gaps are in [error-reporting.md](error-reporting.md#redaction).
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

What the gates do not see, so a reviewer still must: a procedure whose `runProcedure` call sits in dead code; an awaited call made through a wrapper in another file; a call that is only covered by a wide span around a whole block, not one of its own; a `tryPromise` in a small local helper whose caller adds the span (the gate flags this one: put the span in the helper). The ticket asked for "a public repository or service method without a span"; the rule checks awaited calls instead, because a method that only buffers or reads config needs no span.

The `console` ban is Biome's `noConsole` rule (issue #79), not a house rule.
