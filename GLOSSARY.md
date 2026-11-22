# Glossary

- `HealthRepository`: Effect service in `app/repositories/health.ts`; `pingDatabase()` runs `select 1` on D1 and reports `{ ok, latencyMs, error? }`, with a failure as data.
- `dbHealth`: admin-only tRPC query `admin.dbHealth`; returns `{ ok, latencyMs, checkedAt, error? }`.
- **Shared harness**: the agents, workflows, skills, commands, hook and scripts kept in one shared repo and committed into each project as a copy that `sync` writes and nobody edits by hand ([ADR 0001](docs/adr/0001-harness-delivery.md)). Not a plugin.
- **Pack**: a folder in the shared repo that holds the agents and checks for one stack or one area (the stack pack, the design pack). `sync` copies it beside the core. Not a plugin.
- `sync`: the command that copies the head of the shared repo's default branch into a project and writes the harness lock file. `sync --check` fails the harness gate when a copied file was changed by hand, and notes how many commits the copy is behind.
- **Harness lock file**: the file in a project that records which shared-repo commit its copy came from, with a hash for each copied file. A record, not a pin: nothing reads it to choose what to fetch.
- **Protected user**: a user an admin may not change through the app or Better Auth's admin endpoints: any user whose `role` list holds `admin`, and the caller themself. `isProtectedUser` in `app/auth/protected-user.ts`; see [`docs/auth.md`](docs/auth.md).
- `RateLimiter`: Effect service in `app/services/rate-limit.ts`; `check(rule, key)` counts one attempt in the Workers Rate Limiting binding and fails with `RateLimitError` over the limit. A limiter fault lets the request through ([ADR 0002](docs/adr/0002-rate-limit-store.md), [`docs/auth.md`](docs/auth.md#rate-limits)).
