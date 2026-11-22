# Error reporting

There is one capture path. Plain code in a request calls `context.reportError({ error, source })`; Effect code does `yield* (yield* ErrorReporter).capture({ error, source })`. Both build one `ErrorReport` and hand it to the adapter under `ctx.waitUntil`, so a report adds no latency. A delivery failure is logged and dropped; `capture` never fails. Unlike `Analytics`, a report is sent at once and not when the runtime is disposed, because an error can arrive after disposal (a streamed render).

`workers/app.ts` makes one reporter per request (`requestErrorReporter`). It reports one error object once per request, even when two hooks see it. It sends at most 10 reports per request, and logs when it drops the rest.

## Entry points

| `source` | Where it is captured |
|----------|----------------------|
| `fetch` | The fetch handler in `workers/app.ts`: a thrown error, or a failed auth runtime. Both answer 500 with the request id in the body. |
| `loader` / `action` | `handleError` in `app/entry.server.tsx`, which React Router calls for a failed loader or action. `GET` and `HEAD` give `loader`; other methods give `action`. An aborted request is skipped. |
| `render` | The server render's `onError` in `app/entry.server.tsx`, only after the shell has rendered. |
| `trpc` | `onError` of the HTTP handler in `app/routes/api/trpc.$.ts`, and of the server-side caller in `workers/app.ts`. |
| `upload` | The failure branch of `app/routes/api/upload-file.ts`. |
| `boundary` | The root error boundary in `app/root.tsx`, in the browser. It skips an error the server already rendered and a route response below 500. |
| `window` / `rejection` | The browser `error` and `unhandledrejection` events, installed by `app/entry.client.tsx`. |
| `csp` | A CSP violation the browser posts to the endpoint below. |

The three browser sources reach the server through `POST /api/browser-report`. A page sends at most 10 reports and skips repeats (same name, message and first stack line).

## What a report carries

`id`, `timestamp`, `source`, `kind`, `level`, `name`, `message`, `stack`, `tag`, `requestId`, `userId`, `release`, `environment`, `method`, `path`, `url`. The type is `ErrorReport` in `app/lib/error-reporting/adapter.ts`.

- `requestId`, `method` and `path` come from the request the Worker is serving. The id is the `traceparent` trace id, else a well-formed `cf-ray`, else random (`app/lib/request-context.ts`).
- `userId` comes from the session, never from the browser. It is set once the session resolves, so a report made before that has none.
- For a browser report, `requestId` is the page's own id (from `<html data-request-id>`). It falls back to the id of the report request when the page sent none or a malformed one.
- `release` and `environment` come from the env vars below.
- `url` is the page URL for a browser or CSP report, without its query string or fragment.
- `name`, `message` and `stack` are clipped to 128, 1024 and 8192 characters.
- A route error response the browser meets (a failed client navigation) is named `RouteErrorResponse`, with its status as the message.

## Expected or defect

`classifyError` (`app/lib/error-reporting/classify.ts`) reads the error and sets `kind`, `level`, `name`, `message` and `tag`:

| Input | `kind` | `level` |
|-------|--------|---------|
| A tagged error (has `_tag`; see `app/models/errors/`) | `expected` | `error` |
| A `TRPCError` with a code below 500 | `expected` | `warning` |
| A `TRPCError` with a server code (`INTERNAL_SERVER_ERROR`, `NOT_IMPLEMENTED`, `BAD_GATEWAY`, `SERVICE_UNAVAILABLE`, `GATEWAY_TIMEOUT`) | that of its `cause` (`app/lib/effect-trpc.ts` sets one on every 5xx) | `error` |
| A response-like error (`status` and `statusText`) below 500 | `expected` | `warning` |
| A response-like error at 500 or above | `defect` | `error` |
| An Effect `Cause` | a `die` is a `defect`; a typed failure is classified as above; an interruption is a `defect` | by that rule |
| Anything else (a thrown `Error`, a string, a browser error) | `defect` | `error` |

A capture may pass its own `level`; CSP reports pass `warning`.

`kind` says whether the code expected the failure: a tagged error is one you modelled, a defect is a bug. `level` says how loud it is. The console adapter writes every report, as an error line for `error` and a warning line for `warning`. With Sentry on, the log line is always written, and only level `error` reports are sent on. Sends to Sentry share a per-isolate budget of 300 per 60 seconds (`remoteBudget` in `app/services/error-reporter.ts`): past it, a report is logged but not sent, so an error storm cannot spend the backend's quota. Only a report that is sent spends it: CSP reports (level `warning`) do not. The budget is larger than the browser endpoint's, so browser posts alone cannot use it up.

tRPC never sends a 5xx `cause` to the client, and `app/trpc/index.ts` shows `schemaError` for `BAD_REQUEST` only, so the detail in a report does not reach a user.

## The browser endpoint

`POST /api/browser-report` (`app/routes/api/browser-report.ts` and `app/lib/error-reporting/browser-report.ts`). The page sends to it from `app/lib/error-reporting/browser.ts`, and the CSP header points at it (`report-uri` and `Reporting-Endpoints` in `workers/security-headers.ts`).

| Content type | Body |
|--------------|------|
| `application/json` | One browser error: `source` (`boundary`, `window` or `rejection`), `name`, `message`, optional `stack`, `url`, optional `requestId`. |
| `application/csp-report` | The legacy CSP report, `{ "csp-report": { ... } }`. |
| `application/reports+json` | The Reporting API list. Only `csp-violation` entries are kept. |

| Status | Meaning |
|--------|---------|
| 204 | Accepted. A Reporting API list with no CSP entry is accepted too. |
| 400 | The body is not JSON, cannot be read, or does not match the schema. |
| 405 | Not `POST`. The response carries `Allow: POST`. |
| 413 | The body is over 64 KiB (checked by `Content-Length`, and again while reading). |
| 415 | A content type not listed above. |
| 429 | The budget is spent. The response carries `Retry-After: 60`. Only a body that passed every check above spends the budget, so refused posts cannot shut out real reports. |
| 500 | The handler failed. |

Caps: a Reporting API list holds at most 10 entries, and every string in a body has a length cap.

The limit today is a per-isolate budget of 120 accepted reports per 60 seconds (`browserReportBudget` in the route). It is a stopgap: the shared rate limiter from issue #80 replaces that one line. Each isolate has its own budget, and a restart resets it. It is not keyed by caller, so one caller who posts well-formed reports can spend it for everyone on that isolate until the window ends; server-side capture is not affected. Like every route, the endpoint runs after `workers/app.ts` has resolved the session, so the budget does not save that cost; a limiter placed before the handler would.

A refused post is logged at `debug` with its status and a fixed reason, never with any part of the body. Production logs start at `info`, so refusals add no log volume there.

The server does not trust the body for the user id, release, environment, method, path, `kind` or `level`: it sets them. The schema accepts three values for `source`; CSP reports get `csp`. The `requestId` is checked for shape only (`[A-Za-z0-9-]`, 64 characters at most), so treat it as a label a client can set. The text is untrusted too; it is redacted as below before it is logged or sent.

## Redaction

`buildReport` passes `name`, `message`, `stack` and `tag` through `redactText` (`app/lib/redact.ts`). Each is cut to twice its cap first, then redacted, then cut to the cap, so a huge message costs little and a secret is not cut in half at the edge.

- An email address becomes `email:<16 hex characters of its SHA-256>`, after lower-casing and trimming.
- The rest of an `authorization` or `cookie` line becomes `[redacted]`.
- A bearer token, a JWT, the password in a URL (`scheme://user:password@host`), and the value of a `password`, `token`, `secret`, `api_key`, `session` or `credential` pair (`password=...`, `"token":"..."`) become `[redacted]`.
- In a failed database query (a Drizzle error), everything after `params:` becomes `[redacted]`: the bound values, and any stack frames after them in the same text. The SQL text stays.
- A URL loses its query string and fragment, and a path segment of 24 or more characters that holds a digit (a token or an id) becomes `[redacted]`. The same goes for the request `path`.

The hash is unsalted. It hides an address from a reader and lets you join lines about one address, but anyone with a list of candidate addresses can hash them and test for a match. It is not a secret store. Text redaction is best effort: a secret in a shape the patterns miss gets through, so keep secrets out of error messages. Known gaps: a bare OAuth `code=` or `state=` value in a message, an unquoted value with a space in it (the part after the space stays), a quoted value with no closing quote or with an escaped quote inside it, and a path segment with no digit.

## Add a provider

1. Write an `ErrorReporterAdapter` in `app/lib/error-reporting/adapters/<name>.ts`: a `name` and `send(batch)`, which fails with `ExternalServiceError`.
2. Add one `case` to `selectErrorAdapter` in `app/services/error-reporter.ts`, and the name to `ERROR_REPORTER` in `workers/env.d.ts`.

## Add a capture call

- Plain code with the load context: `context.reportError({ error, source: "..." })`.
- Effect code: `const reporter = yield* ErrorReporter`, then `yield* reporter.capture({ error, source })`.
- A place the table above does not cover needs a new entry in `ERROR_SOURCES` in `app/lib/constants/error-reporting.ts` and a row in that table.

Pass the error as it is (a `Cause`, a tagged error, a thrown value). Do not build the message yourself: `classifyError` and `redactText` do that.

## Environment

| Var | Meaning |
|-----|---------|
| `ERROR_REPORTER` | `console` (default), `none` or `sentry`. |
| `SENTRY_DSN` | The Sentry project DSN. A secret: `.dev.vars` locally, `wrangler secret put SENTRY_DSN` in production. It must be `https` (plain `http` is taken for `localhost` only). With `sentry` and no usable DSN, the reporter falls back to `console`. |
| `RELEASE_VERSION` | Default `unversioned`. The deploy step should pass it, for example `wrangler deploy --var RELEASE_VERSION:<git sha or tag>`. |
| `ENVIRONMENT` | Default `development` in dev, else `production`. A preview or staging deploy should pass its own name the same way (`--var ENVIRONMENT:staging`). |

## Check span export against a real collector

Owner step. Not run yet. The span exporter (`app/services/tracing.ts`) has unit tests for the OTLP/HTTP JSON shape, but nobody has run it against a real collector in this repo.

1. Write `otel-collector.yaml`:

   ```yaml
   receivers:
     otlp:
       protocols:
         http:
           endpoint: 0.0.0.0:4318
   exporters:
     debug:
       verbosity: detailed
   service:
     pipelines:
       traces:
         receivers: [otlp]
         exporters: [debug]
   ```

2. Start the collector:

   ```sh
   docker run --rm -p 4318:4318 \
     -v "$PWD/otel-collector.yaml:/etc/otelcol/config.yaml" \
     otel/opentelemetry-collector
   ```

3. Put `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` in `.dev.vars`, run `bun run dev` and load a page.
4. In the collector's output, find the `http.request` span. It should carry `request.id` and `http.response.status_code`. A response of 500 or more marks the span as an error.

If the span is missing or malformed, the fix is in `app/services/tracing.ts`. Note what the collector printed.

## Known limits

- The Sentry adapter posts the name, message and tags, and puts the stack in `extra.stack`. It sends no parsed frames and no source maps.
- The Sentry adapter has not been run against a real Sentry project.
- The browser hook in the error boundary is covered by the e2e spec (a failed client navigation), not by a unit test. No test renders a server 500 page and checks that the browser does not report it again; the rule behind it (`shouldReportBoundaryError`) has a unit test.
- An anonymous caller can post made-up browser errors. They are capped, redacted, tagged with their `source` and bounded by the two budgets, but they are not proof that a user saw an error. Filter on `source` in the backend if they become noise.
- A source label is a best guess for `loader` and `action`: a render error that fails before the shell reaches `handleError` and is labelled by the request method.
