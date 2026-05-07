# High-Level Architecture — Index

System-level docs. Conceptual diagrams, runtime model, data flow, security posture, third-party surface area. **Read these before designing a feature** — they establish the "what runs where" mental model.

## Files

| File | Covers | Read when |
|------|--------|-----------|
| [`architecture.md`](architecture.md) | System layers (Client → CF Workers → D1), data flow, layer responsibilities | Designing any new feature; touching the request lifecycle |
| [`data-models.md`](data-models.md) | Entity diagrams, table schemas (`user`, `session`, `account`, `verification`), migrations | Adding a table, FK, or migration |
| [`security.md`](security.md) | Auth flow, session management, RBAC, ban system, input validation, secrets | Anything touching auth, permissions, secrets, or PII |
| [`integrations.md`](integrations.md) | Cloudflare bindings (D1, R2, AI, Workflows, ASSETS), Better Auth, i18n stack | Wiring a new external service or CF binding |
| [`user-journeys.md`](user-journeys.md) | Auth flows (signup, login, logout), admin journeys, role-based access | Building UI flows; verifying auth gates |

## Quick mental model

```
Browser → CF Worker (React Router SSR + tRPC + Better Auth)
        → Effect ManagedRuntime (per request, built in app/runtime.ts)
        → Repositories (Effect.Service)
        → D1 / R2 / AI / Workflows (CF bindings declared in wrangler.jsonc)
```

Sessions persist in the D1 `session` table via Better Auth's drizzle adapter. There is no KV binding.

## Important things to look at

- `architecture.md` data flow diagram — single source for "where does a request go"
- `data-models.md` entity relationships — every new table extends this graph
- `security.md` session storage section — explains why we never `process.env`
- `integrations.md` CF bindings table — list of bindings exposed via `Env` / `CloudflareEnv`

## Update triggers

- Add/remove a top-level service (D1, R2, KV, AI, etc.) → `architecture.md` + `integrations.md`
- Add/rename DB table → `data-models.md`
- Change auth/RBAC/session → `security.md` + `user-journeys.md`
- Add new third-party SDK → `integrations.md`
