# AGENTS.md

`CLAUDE.md` is a symlink to this file. **Edit `AGENTS.md` only**; never replace the symlink with a real file. Workflows, commands, gates, installs: [`docs/agents/harness.md`](docs/agents/harness.md).

## Overview

SaaS starter on **Cloudflare Workers + React Router v7 + tRPC + D1/Drizzle + Better Auth + Effect TS + ShadCN/Tailwind**.

**Retrieval over recall.** Read the issue, `context-memory` recall, `GLOSSARY.md` and `docs/adr/` first. Training data is not project state.

## Where things live

| What | Where |
|------|-------|
| Work, specs, tickets | GitHub issues ([`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md)); `--label ready-for-agent` |
| Domain terms | `GLOSSARY.md`  |
| Hard-to-reverse decisions | `docs/adr/NNNN-<slug>.md` ([`docs/agents/domain.md`](docs/agents/domain.md)) |
| Proof a flow works | `.verify/<slug>/` (screenshots + `verdict.md`, gitignored), pasted in the PR |
| Working memory per feature | [`context-memory`](.claude/agents/context-memory.md) store outside the repo (`./scripts/memory-dir.sh`) |

`context-memory`: **recall** is read-only, run it at the start of any task. **record** merges decisions, todos and where work stopped; run it once at the end, from the main thread, never in lanes. Never run `lavish-axi share` (public host). Workflow agents cannot poll the user: the workflow returns a `review` page path; the main thread polls it.

## Workflow

1. **Start:** `context-memory` recall, `gh issue view <n>`, `./scripts/verify.sh --baseline`. If red, stop and say so.
2. **Plan** (when a decision is involved): `/grill-me` or `/grill-with-docs`, then `/to-spec`, then `/to-tickets`.
3. **Work:** one ticket at a time, lanes in parallel (below).
4. **Verify:** `feature-verifier` browser-walks any user-visible flow.
5. **Done:** `./scripts/verify.sh` green, PASS verdict in the PR, PR has `Closes #<n>`, one `context-memory` record.

Trivial edits (typo, comment, one line) skip the bookends, but never skip `./scripts/verify.sh` on user-visible work. `./scripts/verify.sh` runs every gate, `--baseline` the quick set; the list is in `scripts/verify.sh`.

## Delegate in parallel

Any change beyond one file runs as parallel sub-agents, not one long thread.

1. **Fix the contract:** types, procedure signatures, lane path fences. The only sequential step.
2. **Build lanes:** one `Agent` call per lane, all in one message: data (schema + repository + tests) · api (tRPC procedure + tests) · UI (`ui-builder`). Lanes own disjoint paths; a lane needing a file it does not own stops and reports.
3. **Writers:** `test-author` ‖ `span-instrumenter`.
4. **Checkers:** `effect-ts-enforcer` ‖ `feature-verifier` ‖ design critique ‖ `./scripts/verify.sh`. Read-only; each browser lane owns its port (`CI=1 bun run dev --port <free>`).
5. **Converge:** the main thread reads every report, re-dispatches the owner of each P0/P1, then runs Done. Lanes never record.

`/build-feature` runs the build as a workflow; `plan-feature` plans it first (ticket or idea to a decision record on the issue). Stay sequential for a one-file change, an unknown interface, a red baseline, or lanes sharing a file.

## Scope policy

- **One ticket in progress at a time.** Assign yourself (`gh issue edit <n> --add-assignee @me`).
- **Done** is Workflow step 5, plus a PASS `feature-verifier` verdict for user-visible work.
- **Scope creep:** if you touch >2 tickets in one diff, stop and split. A cross-feature refactor is its own ticket.

## Frontend tasks: load a design skill every time

Load one of these before the first UI edit; one lead per surface. Use the plain name; on "Unknown skill" use the plugin name (`impeccable:impeccable`, `taste-skill:design-taste-frontend`).

| Lane | Skill |
|------|-------|
| Direction, net-new or redesign, before any JSX | the lead's own: `impeccable` `shape` · `design-taste-frontend` direction library |
| Lead, app screens (dashboard, admin, settings, tables) | `impeccable` |
| Lead, public pages (landing, marketing, pricing, hero) | `design-taste-frontend` |
| Critique the render, before verify | the lead's own: `impeccable` `critique` · `design-taste-frontend` `references/critique.md` loop |
| Finish pass before verify, any surface | `impeccable` `audit` / `harden` / `polish` |
| Motion | `emil-design-eng` + `animate` (build) · `review-animations` (critique) |

Every UI agent reads `PRODUCT.md` and `DESIGN.md` before its first edit (a fresh fork runs `brand-init` first).

**Critique gates the work.** Judge desktop and mobile screenshots. App screens: fix every `impeccable` P0/P1, then critique again. Public pages: run the taste loop up to three rounds; a page under 7.5 is reported as such, never rounded up. Paste the last critique into the verdict.

`ui-ux-pro-max` (a11y) still applies. Tokens in `app/app.css` beat every skill.

## Five non-negotiables

Enforced by `scripts/check-non-negotiables.ts`.

1. **Effect TS** is the default. No `throw`, no `try/catch` outside `Effect.tryPromise`.
2. **Effect Schema** for all validation. **No Zod.**
3. **Tagged errors** in `app/models/errors/`. Map in `app/lib/effect-trpc.ts`.
4. **Unit test for every helper and repository.**
5. **Cloudflare Workers, not Node.** Bindings via `CloudflareEnv` Tag or `context.cloudflare.env`. Never `process.env`.

## When you change something

| Change | Do |
|--------|----|
| New tagged error | Add it to `tagToTRPC` in `app/lib/effect-trpc.ts` |
| New helper or repository | Add its unit test in the same diff |
| New / changed DB table or user-visible data | Extend the fixtures in `scripts/seed-preview.ts` |
| New / changed user-visible flow | `feature-verifier` → `.verify/<slug>/verdict.md`, in the PR |
| New / changed feature | A GitHub issue (`/to-spec`, `/to-tickets`); its PR closes it |
| A new domain term | `GLOSSARY.md`  |
| A decision worth keeping | `context-memory` record (dated, why); an ADR if hard to reverse; an agent rule goes in this file |
| Stopping mid-feature | `context-memory` record: where you stopped, what is next, open todos |
