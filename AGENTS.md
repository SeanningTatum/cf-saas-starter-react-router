# CLAUDE.md — Brain Pointer

> Same content lives in [`AGENTS.md`](AGENTS.md). Both files are entry points for any AI agent (Claude Code, Cursor, Codex, Aider). All real content lives under [`.brain/`](.brain/). **Keep both files in sync** when editing.

## Overview

SaaS starter on **Cloudflare Workers + React Router v7 + tRPC + D1/Drizzle + Better Auth + Effect TS + ShadCN/Tailwind**. Email/password auth, admin dashboard, file upload (R2), analytics, i18n, dark mode.

> **Retrieval over recall.** Read the relevant `.brain/<folder>/index.md` before any task. The index points to the right doc(s). Do not rely on training data for project-specific patterns.

## Read-before-task workflow

For every non-trivial task, run the recipe bookends:

1. **Start:** [`/start-task`](.claude/commands/start-task.md) (or [`.brain/recipes/00-before-task.md`](.brain/recipes/00-before-task.md)) — runs baseline, reads the brain, frames task, opens run note, writes progress entry.
2. **Work:** the matching recipe / rule / feature doc.
3. **End:** [`/verify-done`](.claude/commands/verify-done.md) (or [`.brain/recipes/99-verify-done.md`](.brain/recipes/99-verify-done.md)) before declaring done.

For trivial edits (typo, comment, one-line change), bookends are optional — but never skip the verify step on user-visible work.

## Slash commands (deterministic gates)

| Command | Purpose |
|---------|---------|
| [`/start-task`](.claude/commands/start-task.md) | Kickoff — `init.sh --baseline` + brain read + framing + run note + progress entry. Refuses if scope policy violated. |
| [`/verify-done`](.claude/commands/verify-done.md) | Full verification — typecheck/test/e2e/build/UI/brain coherence/non-negotiables. |
| [`/ship-feature`](.claude/commands/ship-feature.md) | Close out — verify-done + flip `feature_list.json` + update feature MD + close run note + harness-check. |
| [`/harness-check`](.claude/commands/harness-check.md) | Validate 10 harness invariants via [`scripts/harness-check.sh`](scripts/harness-check.sh) (deterministic, no LLM, exits non-zero on drift). |

## Harness — what holds this together

This repo follows the [5-subsystem harness framework](.brain/HARNESS.md). The five concerns:

1. **Instructions** — this file + `.brain/` (rules, recipes, features)
2. **State** — [`.brain/features/feature_list.json`](.brain/features/feature_list.json) (machine-readable status), [`.brain/runs/progress.md`](.brain/runs/progress.md) (rolling cursor), per-task `.brain/runs/<date>-<slug>.md`
3. **Verification** — [`.brain/recipes/99-verify-done.md`](.brain/recipes/99-verify-done.md) + `/verify-done`
4. **Scope** — see "Scope policy" below
5. **Lifecycle** — [`init.sh`](init.sh) at repo root + SessionStart hook in `.claude/`

## Scope policy

- **One in-progress feature at a time.** Source of truth: `status: "in-progress"` row in [`.brain/features/feature_list.json`](.brain/features/feature_list.json). If you must start a second, mark the first `blocked` with reason in `evidence`.
- **Definition of done** for any feature/task: implementation complete + `/verify-done` passes + per-feature `.brain/features/<slug>.md` updated + `feature_list.json` status flipped + run note closed.
- **Scope creep guardrail**: if you touch >2 features in one diff, stop and split. Cross-feature refactor is a separate task with its own run note.

## Brain layout

```
.brain/
├── HARNESS.md                 The harness, explained — read once
├── high-level-architecture/   System layers, data flow, security, integrations, user journeys
├── codebase/                  Programming model, helpers, tests, i18n, tRPC API surface
├── rules/                     Layer-aligned conventions (frontend / cloudflare / repository / services / routes / library / errors)
├── features/                  Per-feature memory — one MD per feature + feature_list.json (machine-readable status)
├── recipes/                   Step-by-step runbooks (00-before-task, 99-verify-done, add-*)
├── runs/                      progress.md (rolling cursor) + per-task <date>-<slug>.md work logs
├── transcripts/               Meeting notes, decision logs
├── emails/                    Archived stakeholder correspondence
└── CHANGELOG.md               High-level project + brain change log
```

## Index map — open these first

| Folder | Index | Read when |
|--------|-------|-----------|
| High-level architecture | [`.brain/high-level-architecture/index.md`](.brain/high-level-architecture/index.md) | Designing a feature; touching auth, DB schema, integrations, request lifecycle |
| Codebase | [`.brain/codebase/index.md`](.brain/codebase/index.md) | **Every code change.** Default reading. Effect TS programming model, helpers, tests, i18n, tRPC API surface |
| Rules | [`.brain/rules/index.md`](.brain/rules/index.md) | Editing in a specific layer — 7 layer-aligned rules (frontend / cloudflare / repository / services / routes / library / errors) |
| Features | [`.brain/features/index.md`](.brain/features/index.md) | Modifying or extending an existing feature; before scoping a new one |
| **Recipes** | [`.brain/recipes/index.md`](.brain/recipes/index.md) | **Adding code.** Step-by-step runbooks: 00-before-task / 99-verify-done bookends + tRPC endpoint, DB table, CF binding, tagged error, route, service, feature. Read this before writing. |
| Runs | [`.brain/runs/index.md`](.brain/runs/index.md) | Multi-session task or recovery after compaction — past attempts, baselines, what failed and why |
| Transcripts | [`.brain/transcripts/index.md`](.brain/transcripts/index.md) | A constraint or decision in code lacks visible "why" |
| Emails | [`.brain/emails/index.md`](.brain/emails/index.md) | Same — for stakeholder-driven constraints |
| Changelog | [`.brain/CHANGELOG.md`](.brain/CHANGELOG.md) | Recent architectural or brain shifts |

> Reusable Claude Code agents / skills / commands are provided by the shared plugins (`cf-saas-stack`, `dev-workflows`) — not stored in `.brain/`. See `README.md` for plugin install steps.

## Rules — 7 layers

Direct pointers (each rule is the canonical "do / don't" for one layer):

| # | Rule | Layer |
|---|------|-------|
| 1 | [`.brain/rules/frontend.md`](.brain/rules/frontend.md) | UI, forms, modals, Tailwind, manual Playwright verification |
| 2 | [`.brain/rules/cloudflare.md`](.brain/rules/cloudflare.md) | Workers runtime, bindings, env, Workflows declaration |
| 3 | [`.brain/rules/repository.md`](.brain/rules/repository.md) | `Effect.Service` repos, Drizzle schema, repo inputs |
| 4 | [`.brain/rules/services.md`](.brain/rules/services.md) | Effect Tags + Layers, Better Auth, Workflows, Session, Logger |
| 5 | [`.brain/rules/routes.md`](.brain/rules/routes.md) | tRPC procedures via `runProcedure`, React Router loaders, auth gating |
| 6 | [`.brain/rules/library.md`](.brain/rules/library.md) | Helpers, Effect Schema, effect-utils, Vitest, Playwright e2e |
| 7 | [`.brain/rules/errors.md`](.brain/rules/errors.md) | Tagged errors, `tagToTRPC`, error helpers |

## Five non-negotiables

(Full detail in [`.brain/codebase/effect-ts.md`](.brain/codebase/effect-ts.md).)

1. **Effect TS** is the default. No `throw`, no `try/catch` outside `Effect.tryPromise`.
2. **Effect Schema** for all validation. **No Zod.**
3. **Tagged errors** in `app/models/errors/`. Map in `app/lib/effect-trpc.ts`.
4. **Unit test for every helper and repository.** See [`.brain/codebase/testing.md`](.brain/codebase/testing.md).
5. **Cloudflare Workers, not Node.** Bindings via `CloudflareEnv` Tag or `context.cloudflare.env`. Never `process.env`.

## Commands

```bash
./init.sh                 # Harness bootstrap — install + migrate + typecheck + test (run start of session)
./init.sh --baseline      # Baseline only (typecheck + test) — used by 00-before-task.md
bun run dev               # Dev server (auto-runs local DB migrations) → http://localhost:5173
bun run build             # Production build
bun run deploy            # Build + deploy to Cloudflare Workers
bun run typecheck         # Full typecheck (cf-typegen + react-router typegen + tsc)
bun run test              # Vitest unit tests (one-shot)
bun run test:watch        # Vitest watch mode
bun run test:e2e          # Playwright e2e tests
bun run db:generate       # Generate Drizzle migration
bun run db:migrate:local  # Apply migrations to local D1
bun run db:migrate:remote # Apply migrations to remote D1
bun run db:studio         # Drizzle Studio
```

## When you change something — update the brain

| Change | Update |
|--------|--------|
| New service / CF binding | `high-level-architecture/architecture.md` + `integrations.md` |
| New / renamed DB table | `high-level-architecture/data-models.md` |
| Auth / RBAC / session change | `high-level-architecture/security.md` + `user-journeys.md` |
| New helper / convention | `rules/library.md` (or `codebase/<topic>.md` if cross-cutting) |
| New tRPC route | `rules/routes.md` + `codebase/api.md` |
| New repository | `rules/repository.md` |
| New service / external client | `rules/services.md` + `high-level-architecture/integrations.md` |
| New tagged error | `rules/errors.md` (and add to `tagToTRPC`!) |
| New UI component / form | `rules/frontend.md` |
| New CF binding | `rules/cloudflare.md` + `high-level-architecture/architecture.md` |
| New / changed feature | `features/<slug>.md` (use `_TEMPLATE.md`) |
| Architectural shift | append to `CHANGELOG.md` |
| Stakeholder decision | drop file in `transcripts/` or `emails/`, link from `CHANGELOG.md` |

## Sync rule

When you edit `CLAUDE.md`, mirror to `AGENTS.md` (or vice versa). They are intentionally duplicated to satisfy both Claude Code (`CLAUDE.md`) and AGENTS-spec tools (Codex, Aider, …) at repo root without symlinks.
