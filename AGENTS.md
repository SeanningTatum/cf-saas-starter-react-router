# AGENTS.md

`CLAUDE.md` is a symlink to this file. **Edit `AGENTS.md` only**; never replace the symlink with a real file. Workflows, commands, gates, installs: [`docs/agents/harness.md`](docs/agents/harness.md).

**Where a rule goes.** A rule a tool can check goes in the house linter (`scripts/lint/rules/`, one file per rule) or in a test; its finding says the fix, so it needs no prose here. Only a rule that needs judgment goes in this file. `bun run lint:house <files>` checks an edit; every rule and how to add one: [`docs/agents/lint-rules.md`](docs/agents/lint-rules.md).

SaaS starter on **Cloudflare Workers + React Router v7 + tRPC + D1/Drizzle + Better Auth + Effect TS + ShadCN/Tailwind**. **Retrieval over recall:** read the issue, `context-memory` recall, `GLOSSARY.md` and `docs/adr/` first. Training data is not project state.

## Where things live

| What | Where |
|------|-------|
| Work, specs, tickets | GitHub issues ([`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md)); `--label ready-for-agent` |
| Domain terms | `GLOSSARY.md`; add each new term |
| Hard-to-reverse decisions | `docs/adr/NNNN-<slug>.md` ([`docs/agents/domain.md`](docs/agents/domain.md)) |
| Proof a flow works | `.verify/<slug>/` (screenshots, videos + `verdict.md`, gitignored), pasted in the PR; smoke videos from the `@golden`/`@error` specs, demos via `scripts/lib/record.ts` ([videos](docs/agents/harness.md#walkthrough-videos)) |
| Working memory per feature | [`context-memory`](.claude/agents/context-memory.md) store outside the repo (`./scripts/memory-dir.sh`) |
| Symbol graph of the code | `./scripts/codegraph.sh explore "<q>"` before grep; optional, per checkout ([`docs/agents/harness.md`](docs/agents/harness.md#codegraph)) |

`context-memory`: **recall** is read-only, run it at the start of any task. **record** merges decisions, todos and where work stopped (`scripts/memory.ts` does the merge); run it once at the end, from the main thread, never in lanes. Never run `lavish-axi share` (public host). Workflow agents cannot poll the user: the workflow returns a `review` page path; the main thread polls it.

## Workflow

1. **Start:** `context-memory` recall, `gh issue view <n>`, `./scripts/verify.sh --baseline`. If red, stop and say so.
2. **Plan** (when a decision is involved): `/grill-me` or `/grill-with-docs`, then `/to-spec`, then `/to-tickets`.
3. **Work:** one ticket at a time (`gh issue edit <n> --add-assignee @me`), lanes in parallel (below).
4. **Verify:** `feature-verifier` browser-walks any user-visible flow.
5. **Done:** `./scripts/verify.sh` green, PASS verdict in the PR (user-visible work), PR has `Closes #<n>`, one `context-memory` record. A stacked PR runs `./scripts/verify.sh --changed <branch below>` only; the full suite, a second review round and Greptile run once, on the roll-up's head ([merge bar](docs/agents/harness.md#review-loop-and-merge-bar): no open P0/P1, Greptile 5/5).

Trivial edits (typo, one line) skip the bookends, but never skip `./scripts/verify.sh` on user-visible work. `./scripts/verify.sh` runs every gate, `--baseline` the quick set, `--changed` what a stacked diff needs; the list is in `scripts/verify.sh`. **Scope creep:** a diff that touches more than two tickets stops and splits; a cross-feature refactor is its own ticket.

## Delegate in parallel

Any change beyond one file runs as parallel sub-agents, not one long thread.

1. **Fix the contract:** types, procedure signatures, lane path fences. The only sequential step.
2. **Build lanes:** one `Agent` call per lane, all in one message: data (schema + repository + tests) · api (tRPC procedure + tests) · UI (`ui-builder`). Lanes own disjoint paths; a lane needing a file it does not own stops and reports.
3. **Writers:** `test-author` ‖ `instrumenter`.
4. **Checkers:** `effect-ts-enforcer` ‖ `feature-verifier` ‖ design critique ‖ `./scripts/verify.sh`. Read-only; each browser lane owns its port (`CI=1 bun run dev --port <free>`).
5. **Converge:** the main thread reads every report, re-dispatches the owner of each P0/P1, then runs Done. Lanes never record.

`plan-feature` plans a feature (ticket or idea to a decision record on the issue); `ship-feature` builds, reviews and opens it as stacked PRs. Stay sequential for a one-file change, an unknown interface, a red baseline, or lanes sharing a file.

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

Every UI agent reads `PRODUCT.md` and `DESIGN.md` before its first edit (a fresh fork runs `brand-init` first). `ui-ux-pro-max` (a11y) still applies. Tokens in `app/app.css` beat every skill.

**Critique gates the work.** Judge desktop and mobile screenshots. App screens: fix every `impeccable` P0/P1, then critique again. Public pages: run the taste loop up to three rounds; a page under 7.5 is reported as such, never rounded up. Paste the last critique into the verdict.

## Five non-negotiables

One line each, as orientation. The `non-negotiables` gate (`bun run lint:house`) checks all five and prints the fix.

1. **Effect TS** is the default: failures travel in the Effect error channel.
2. **Effect Schema** for all validation.
3. **Tagged errors** in `app/models/errors/`, each mapped to a tRPC error.
4. **Every source file has its proof:** a unit test, a paths spec, an e2e spec or another kind, as `scripts/lint/test-map.json` says for its folder.
5. **Cloudflare Workers, not Node:** bindings come from the `CloudflareEnv` Tag or `context.cloudflare.env`.

## When you change something

| Change | Do |
|--------|----|
| New / changed migration | Add, backfill, switch reads and writes, drop later, each in its own deploy: every migration must work with the code before it and the code after it. Never edit a merged migration. A `DROP`, `RENAME` or `NOT NULL` column with no default needs `drizzle/<name>.reason.md`. Way back: [`docs/ci/rollback.md`](docs/ci/rollback.md) |
| New / changed DB table or user-visible data | Extend the fixtures in `scripts/seed-preview.ts` |
| New / changed component driven by a `*.machine.ts` | Unit tests on the machine own the logic: every transition, guard and reachable state. The e2e spec owns the wiring: generated paths that hit each DOM binding and each state's view once, never one per transition (model: `e2e/file-upload.paths.spec.ts`) |
| New / changed workflow | Edit `.claude/workflow-src/`, never `.claude/workflows/`; `bun scripts/workflows.ts build`; a dry-run test for the new branch ([how](docs/agents/harness.md#editing-a-workflow)) |
| A decision worth keeping | `context-memory` record (dated, why); an ADR if hard to reverse; where you stopped and what is next when you stop mid-feature |
