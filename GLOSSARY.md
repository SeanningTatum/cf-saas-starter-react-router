# Glossary

- `HealthRepository`: Effect service in `app/repositories/health.ts`; `pingDatabase()` runs `select 1` on D1 and reports `{ ok, latencyMs, error? }`, with a failure as data.
- `dbHealth`: admin-only tRPC query `admin.dbHealth`; returns `{ ok, latencyMs, checkedAt, error? }`.
- **Shared harness**: the agents, workflows, skills, commands, hook and scripts kept in one shared repo and committed into each project as a copy that `sync` writes and nobody edits by hand ([ADR 0001](docs/adr/0001-harness-delivery.md)). Not a plugin.
- **Pack**: a folder in the shared repo that holds the agents and checks for one stack or one area (the stack pack, the design pack). `sync` copies it beside the core. Not a plugin.
- `sync`: the command that copies the head of the shared repo's default branch into a project and writes the harness lock file. `sync --check` fails the harness gate when a copied file was changed by hand, and notes how many commits the copy is behind.
- **Harness lock file**: the file in a project that records which shared-repo commit its copy came from, with a hash for each copied file. A record, not a pin: nothing reads it to choose what to fetch.
- **Request id**: the id each request gets in `makeRequestContext` (`app/lib/request-context.ts`): the `traceparent` trace id, else a well-formed `cf-ray`, else random. The Worker returns it in `x-request-id`, the page carries it in `<html data-request-id>`, and log lines, spans and error reports repeat it. It finds a request's records; never use it to decide access.
- **Error report**: the `ErrorReport` record in `app/lib/error-reporting/adapter.ts` (source, kind, level, name, message, request id, release and more), built by `buildReport` in `app/lib/error-reporting/report.ts` and sent to the adapter.
- **Expected error**: an error report with `kind: "expected"`, which `classifyError` (`app/lib/error-reporting/classify.ts`) sets for a tagged error, a tRPC code below 500 or a response below 500.
- **Defect**: an error report with `kind: "defect"`: a bug, such as a thrown `Error`, an Effect `die`, an interruption or a 5xx response.
- **Error reporter**: the per-request capture path in `app/services/error-reporter.ts`. Plain code calls `context.reportError`; `ErrorReporter` (the Effect service in the same file) offers `capture` to Effect code. Both send one report to the adapter under `ctx.waitUntil`.
- **Browser report endpoint**: `POST /api/browser-report` (`app/routes/api/browser-report.ts`). It takes browser errors and CSP violation reports, applies a size cap and a per-isolate budget, and passes them to the error reporter.
- **Protected user**: a user an admin may not change through the app or Better Auth's admin endpoints: any user whose `role` list holds `admin`, and the caller themself. `isProtectedUser` in `app/auth/protected-user.ts`; see [`docs/auth.md`](docs/auth.md).
