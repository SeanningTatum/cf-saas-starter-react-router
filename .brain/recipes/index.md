# Recipes — Step-by-step runbooks

> Read these first when adding code. Each recipe is a deterministic checklist with file paths, code snippets, and "definition of done". Designed for one-shot agent execution.

## Bookends — run on every non-trivial task

| Recipe | When to use |
|--------|-------------|
| [00-before-task.md](00-before-task.md) | **Start here.** Frame task, read the brain, capture baseline, open run note |
| [99-verify-done.md](99-verify-done.md) | **End here.** Typecheck + tests + e2e + brain coherence before declaring done. Also runnable as `/verify-done` slash command |

## Adding code

| Recipe | When to use |
|--------|-------------|
| [add-trpc-endpoint.md](add-trpc-endpoint.md) | Adding a new tRPC procedure (query or mutation) |
| [add-db-table.md](add-db-table.md) | Adding a new D1/Drizzle table + repository |
| [add-tagged-error.md](add-tagged-error.md) | Adding a new tagged domain error |
| [add-cf-binding.md](add-cf-binding.md) | Wiring a new Cloudflare binding (KV, DO, queue, etc.) |
| [add-feature.md](add-feature.md) | Scoping and shipping a new product feature |
| [add-route.md](add-route.md) | Adding a React Router page (loader/action/UI) |
| [add-service.md](add-service.md) | Wrapping a new external client as an Effect service |

## Decision trees

| Question | Answer key |
|----------|-----------|
| **tRPC procedure vs Workflow vs Worker queue?** | Sync user-driven response → tRPC. Long-running multi-step → Workflow. Fire-and-forget at scale → Queue (binding required first, see [add-cf-binding.md](add-cf-binding.md)). |
| **D1 vs R2 vs KV?** | Relational + queryable → D1. Files/blobs → R2. Per-key cache, ≤25MB, eventually consistent → KV. |
| **Service Tag (Context.Tag) vs Effect.Service vs plain helper?** | Has lifecycle / external client / Layer composition → `Effect.Service` (repos) or `Context.Tag + Layer.effect` (services like `Database`, `AuthApi`). Pure utility → plain function in `app/lib/`. |
| **Loader auth vs procedure auth?** | Both. UI gate prevents UX leaks. Procedure gate enforces security. Never trust UI alone. |
| **Effect Schema vs raw type?** | Cross-boundary input (form, API, env) → `Schema`. Internal-only types → `interface` / `type`. |

## Anti-patterns (will fail review)

- `throw` outside `Effect.tryPromise.catch` (use `Effect.fail` with tagged error)
- `Effect.promise` (use `Effect.tryPromise` — must catch)
- `Promise.then` chained on `runProcedure` (use `Effect.map` inside the gen block)
- `process.env` (use `CloudflareEnv` Tag)
- `Zod` (use Effect Schema)
- Page-level `try/catch` for Effect errors (let `runProcedure` map via `tagToTRPC`)
- Adding tagged error without entry in `tagToTRPC` (check `app/lib/effect-trpc.ts`)
