# Rules — Index

Domain-specific lint-style rules organized by **architecture layer**. Each rule is the "do this, don't do that" reference for one layer of the stack.

> Programming model basics (Effect TS, Schema, tagged errors) live in [`../codebase/effect-ts.md`](../codebase/effect-ts.md). That doc is **always-on context** — read it once, apply everywhere.

## When to read

- Before editing in a layer → read that layer's rule
- When unsure about a convention — rules are terse and actionable
- New contributor onboarding — read all 7, then drill into source

## The 7 layer rules

| # | Rule | Touches | Read when |
|---|------|---------|-----------|
| 1 | [`frontend.md`](frontend.md) | `app/components/**`, `app/routes/**/*.tsx`, `app/app.css` | Building UI, forms (Effect Schema + `effectResolver`), modals, Tailwind / CSS variables, AI prompts in UI, Playwright manual verification |
| 2 | [`cloudflare.md`](cloudflare.md) | `wrangler.jsonc`, `worker-configuration.d.ts`, `workers/app.ts`, `workflows/**` | Adding bindings, env vars, secrets, Workflows definition, anything Workers-runtime-specific |
| 3 | [`repository.md`](repository.md) | `app/repositories/**`, `app/db/schema.ts` | Writing or modifying an `Effect.Service` repository, Drizzle schema, repo input schemas |
| 4 | [`services.md`](services.md) | `app/services/**`, `app/auth/server.ts` | Adding a new external client / Effect service, wiring Better Auth, Workflows, Session, Logger |
| 5 | [`routes.md`](routes.md) | `app/routes/**`, `app/trpc/**` | Adding a tRPC procedure, React Router loader, auth-gating, parallel data fetching |
| 6 | [`library.md`](library.md) | `app/lib/**`, `app/lib/schemas/**`, `app/lib/constants/**`, `e2e/**` | Adding a helper, Effect Schema, constant, AI structured-output config, unit test, e2e test |
| 7 | [`errors.md`](errors.md) | `app/models/errors/**`, `app/lib/effect-trpc.ts` | Adding a tagged error, mapping it to a TRPC code, using error helpers in repos |

## Layer dependency direction

```
frontend ──▶ routes ──▶ services ──▶ repository ──▶ cloudflare
                          ▲             │
                          └────────── library (helpers, schemas, tests)
                                        │
                          all layers ─▶ errors
```

- **frontend** consumes routes (tRPC client) — never reaches into services/repos
- **routes** orchestrate services + repos via `runProcedure`
- **services** wrap external clients; **repos** consume them via `yield*`
- **library** is layer-neutral helpers / schemas / tests
- **errors** are cross-cutting tagged ADTs

## Cross-cutting concerns (folded into multiple layers)

| Concern | Lives in |
|---------|----------|
| Auth (Better Auth) | [`services.md`](services.md) (server config), [`routes.md`](routes.md) (gating), [`frontend.md`](frontend.md) (forms) |
| Effect TS | [`../codebase/effect-ts.md`](../codebase/effect-ts.md) — every layer assumes it |
| Schemas | [`library.md`](library.md) (definitions), [`repository.md`](repository.md) (as inputs), [`routes.md`](routes.md) (tRPC bridge), [`frontend.md`](frontend.md) (form resolver) |
| Testing | [`library.md`](library.md) (patterns), every other rule references it |

## Update triggers

- New convention adopted → update the matching layer rule
- Pattern deprecated → mark `> DEPRECATED` block + replacement pointer (do not silent-delete — agents reference these)
- Layer added (rare) → add an 8th rule + update this index + the dependency direction diagram

## History

Consolidated 2026-05-07 from 29 single-topic rules into 7 layer-aligned rules. Source rules archived in git history. See `.brain/CHANGELOG.md`.

## Old rule → new rule map

If you have stale references to the old `.cursor/rules/` files:

| Old `.cursor/rules/*.mdc` | New layer rule |
|---------------------------|----------------|
| `auth.mdc` | [`services.md`](services.md) (Better Auth config) + [`routes.md`](routes.md) (gating) + [`frontend.md`](frontend.md) (forms) |
| `cloudflare-workflows.mdc` | [`cloudflare.md`](cloudflare.md) (declare) + [`services.md`](services.md) (trigger) |
| `database.mdc` | [`repository.md`](repository.md) |
| `emails.mdc` | [`services.md`](services.md) — but no email service is wired today |
| `environment-variables.mdc` | [`cloudflare.md`](cloudflare.md) |
| `errors.mdc` | [`errors.md`](errors.md) |
| `feature-flags.mdc` | [`services.md`](services.md) — but no feature-flag service is wired today |
| `frontend-task.mdc`, `tailwind.mdc`, `modals.mdc`, `prompts.mdc` | [`frontend.md`](frontend.md) |
| `models.mdc`, `repository-pattern.mdc` | [`repository.md`](repository.md) |
| `routes.mdc` | [`routes.md`](routes.md) |
| `stripe.mdc` | [`services.md`](services.md) — but no Stripe is wired today |
| `structured-output.mdc` | not present (no AI SDK in repo) |
| `testing-workflow.mdc`, `playwright-rules.mdc`, `test-credentials.mdc` | [`library.md`](library.md) |
| `utils.mdc`, `constants.mdc` | [`library.md`](library.md) |
| `context-clients.mdc` | [`services.md`](services.md) |
| `docs.mdc`, `context-md.mdc`, `general-rules.mdc`, `pull-request.mdc`, `fullstack-task.mdc` | dropped (meta) |
