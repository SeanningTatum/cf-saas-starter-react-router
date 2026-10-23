# AGENTS.md

> This is the single source of truth. `CLAUDE.md` is a symlink to this file, so Claude Code, Cursor, Codex, Aider all read the same content. **Edit `AGENTS.md` only** — never replace the symlink with a real file. Project state lives in the brain, `.brain/brain.db`.

## Overview

SaaS starter on **Cloudflare Workers + React Router v7 + tRPC + D1/Drizzle + Better Auth + Effect TS + ShadCN/Tailwind**. Email/password auth, admin dashboard, file upload (R2), analytics, i18n, dark mode.

> **Retrieval over recall.** Ask the brain before any task. Do not rely on training data for project state.

## The brain — brain-axi 0.3.0

The brain is one SQLite file, `.brain/brain.db`: features, tasks, checkpoints, run notes, docs, reviewed plans, verifications and the declared gates. It is **gitignored** — every checkout has its own, and a clone starts empty. The **[brain-axi](https://github.com/SeanningTatum/brain-axi) CLI** (`brain`) is the only way in; every command prints TOON with a `help:` block naming the next command.

Setup (Node ≥ 24 — the CLI uses the built-in `node:sqlite`):

```bash
npm i -g github:SeanningTatum/brain-axi#v0.3.0     # CLI on PATH (not on npm)
claude plugin marketplace add SeanningTatum/brain-axi
claude plugin install brain-axi@SeanningTatum     # skills + SessionStart `brain context`
./scripts/brain-setup.sh                           # create .brain/brain.db + declare the gates
```

`scripts/brain-setup.sh` is idempotent and is the tracked list of gates. `init.sh`, CI and first-time setup all run it.

| Phase | Command |
|-------|---------|
| Orient | `brain` (dashboard) · `brain progress` · `brain features` |
| Look up | `brain search "<q>"` · `brain docs list` · `brain features view <slug>` |
| Record | `brain progress add --summary "..." --next "..."` · `brain runs append <slug> --step "..." --observed "..."` |
| Feature state | `brain features add <slug> --name "..."` · `brain features set <slug> --status <planned\|in-progress\|blocked\|cut>` · `brain features ship <slug> --evidence "..."` |
| Verify | `brain verify --stage baseline` · `brain verify` (all gates) · `brain verifications add <slug> --verdict PASS ...` · `brain check` |
| Plans | `brain review open <plan.html>` · `brain plans list` |

## Workflow

The brain-axi plugin skills carry the method and hand off to each other:

1. **Start:** `brain-axi:brain-start` — read brain state, frame the task, check scope, run `brain verify --stage baseline`, claim the feature.
2. **Plan** (when a decision is involved): `brain-axi:brain-grill` → `brain-axi:brain-plan` (+ `brain-product` / `brain-ux` / `brain-ai`).
3. **Work:** `brain-axi:brain-execute` — log each step with `brain runs append`. Delegate the lanes to sub-agents in parallel (below).
4. **Verify:** `brain-axi:brain-verify` — an independent walk; spawn `feature-verifier` for a browser walk of any user-visible flow.
5. **Done:** `brain-axi:brain-done` — `brain verify` green, `brain check` green, checkpoint, `brain features ship`.

For trivial edits (typo, comment, one-line change), skip the bookends — but never skip `brain verify` on user-visible work.

## Delegate in parallel

Any change beyond one file runs as parallel sub-agents, not one long sequential thread. Most of a feature's order is a compile dependency, not an information one: once the interface is fixed, the server work and the UI work need nothing from each other.

1. **Fix the contract** — types, procedure signatures, and which lane owns which paths. The only sequential step.
2. **Build lanes, one message** — one `Agent` call per lane, all sent together: data (schema + repository + its tests) · api (tRPC procedure + its tests) · UI (`ui-builder`). Each lane owns disjoint paths; a lane that needs a file it does not own stops and reports.
3. **Writer wave** — `test-author` ‖ `span-instrumenter`. Tests and spans touch different files, so they run together.
4. **Checker wave** — `effect-ts-enforcer` ‖ `feature-verifier` ‖ design critique ‖ `brain verify`. All read-only, all need the finished tree. Each browser lane owns its port (`CI=1 bun run dev --port <free>`).
5. **Converge** — the main thread reads every report, re-dispatches the owning agent for each P0/P1, then runs `brain-axi:brain-done`.

A multi-layer feature can run all of this as one workflow with [`/build-feature`](.claude/commands/build-feature.md). Stay sequential for a one-file change, an interface you do not know yet, a red baseline, or two lanes that need the same file.

## Slash commands

| Command | Purpose |
|---------|---------|
| [`/build-feature`](.claude/commands/build-feature.md) | Multi-layer feature build with the sub-agents **fanned out in parallel** — orient → fix the contract (the one sequential step) → build lanes on **disjoint paths** → spans, then verify lanes at once (gates · non-negotiables · browser walk · design critique) → synthesis. Does not commit, does not touch brain state, does not decide for you. |
| [`/harness-check`](.claude/commands/harness-check.md) | [`scripts/harness-check.sh`](scripts/harness-check.sh) = `brain check` + repo supplement (CLAUDE↔AGENTS symlink, sub-agent frontmatter, Kimi roster symlink, hook wiring + hook tests). Deterministic, no LLM, exits non-zero on drift. |

## Gates

Declared in [`scripts/brain-setup.sh`](scripts/brain-setup.sh), run by `brain verify`:

| Gate | Command | Stages |
|------|---------|--------|
| typecheck | `bun run typecheck` | bootstrap, baseline, verify |
| test | `bun run test` | bootstrap, baseline, verify |
| non-negotiables-selftest | `bun run scripts/check-non-negotiables.ts --selftest` | baseline, verify |
| non-negotiables | `bun run scripts/check-non-negotiables.ts` | baseline, verify |
| harness | `./scripts/harness-check.sh` | baseline, verify |
| build | `bun run build` | verify |
| e2e | `bun run test:e2e` | verify |

To add a gate, add a line to `scripts/brain-setup.sh` — CI picks it up.

## Scope policy

- **One in-progress feature at a time** (`brain features list`). To start a second, set the first `--status blocked` and say why in a checkpoint.
- **Definition of done:** implementation complete + `brain verify` green + a PASS verification (`brain verifications add`) + `brain features ship <slug> --evidence "..."`.
- **Scope creep guardrail:** if you touch >2 features in one diff, stop and split. A cross-feature refactor is a separate task.

## Frontend tasks — load a design skill every time

Any task that changes what a user sees loads at least one of these skills before the first UI edit. Each owns a lane, so never run both leads on one surface. Nothing here is a committed copy:

- **Plugins** — `impeccable` (`impeccable:impeccable`) and the taste skill (`taste-skill:design-taste-frontend`) are enabled in [`.claude/settings.json`](.claude/settings.json); Claude Code asks to install them when you trust the repo.
- **Skills without a plugin** — `animate`, `emil-design-eng`, `review-animations` are listed in [`skills-lock.json`](skills-lock.json). [`scripts/restore-skills.sh`](scripts/restore-skills.sh) installs them on session start and links them into `.claude/skills/`; both directories are gitignored.


| Lane | Skill |
|------|-------|
| Direction — tier-2 surfaces (net-new or redesign), before any JSX | the lead's own: `impeccable` `shape` (app screens) · `design-taste-frontend` direction library (public pages) |
| Lead — app screens (dashboard, admin, settings, tables, forms, states) | `impeccable` |
| Lead — public pages (landing, marketing, pricing, hero) | `design-taste-frontend` |
| Critique — the render, before `brain verify` | the lead's own: `impeccable` `critique` (app screens) · `design-taste-frontend` `references/critique.md` loop (public pages) |
| Finish pass before `brain verify`, any surface | `impeccable` `audit` / `harden` / `polish` |
| Motion — anything that moves | `emil-design-eng` + `animate` (build) · `/review-animations` (critique) |

**The critique gates the work.** Judge screenshots at desktop and mobile, not the source. App screens: fix every `impeccable` P0/P1, then critique again. Public pages: run the taste loop up to three rounds; a page still under 7.5 is reported as such, never rounded up. Paste the last critique into the verification body. Typecheck, tests and the browser walk all pass on a templated page; only the critique fails a design for being generic.

`ui-ux-pro-max` (a11y rules) still applies, and the tokens in `app/app.css` beat every skill.

## Five non-negotiables

Enforced by `scripts/check-non-negotiables.ts` (the `non-negotiables` gate).

1. **Effect TS** is the default. No `throw`, no `try/catch` outside `Effect.tryPromise`.
2. **Effect Schema** for all validation. **No Zod.**
3. **Tagged errors** in `app/models/errors/`. Map in `app/lib/effect-trpc.ts`.
4. **Unit test for every helper and repository.**
5. **Cloudflare Workers, not Node.** Bindings via `CloudflareEnv` Tag or `context.cloudflare.env`. Never `process.env`.

## Commands

```bash
brain                     # Brain dashboard (features, in-progress, last checkpoint)
brain verify              # Run every declared gate (--stage baseline for the quick set)
brain check               # Brain integrity (SQLite, foreign keys, search index, shipped ⇒ verified)
brain search "<query>"    # Find text anywhere in the brain
./scripts/brain-setup.sh  # Create .brain/brain.db + declare the gates (idempotent)
./scripts/harness-check.sh # brain check + repo supplement (symlinks, sub-agent frontmatter, hooks)
./init.sh                 # Harness bootstrap — install + brain + migrate + typecheck + test (run start of session)
./init.sh --baseline      # Baseline only (typecheck + test + harness-check)
bun run dev               # Dev server (auto-runs local DB migrations) → http://localhost:5173
bun run build             # Production build
bun run deploy            # Build + deploy to Cloudflare Workers
bun run deploy:preview    # Build with CLOUDFLARE_ENV=preview + deploy the -preview worker
bun run typecheck         # Full typecheck (cf-typegen + react-router typegen + tsc)
bun run test              # Vitest unit tests (one-shot)
bun run test:watch        # Vitest watch mode
bun run test:e2e          # Playwright e2e tests
bun run db:generate       # Generate Drizzle migration
bun run db:migrate:local  # Apply migrations to local D1
bun run db:migrate:remote # Apply migrations to remote D1
bun run db:migrate:preview # Apply migrations to the preview-env D1
bun run db:seed           # Seed local D1 with admin/user/banned fixtures
bun run db:seed:preview   # Seed the preview-env D1 with the same fixtures
bun run db:studio         # Drizzle Studio
```

## When you change something

| Change | Do |
|--------|----|
| New tagged error | Add it to `tagToTRPC` in `app/lib/effect-trpc.ts` |
| New helper or repository | Add its unit test in the same diff |
| New / changed DB table or user-visible data | Extend the fixtures in `scripts/seed-preview.ts` |
| New / changed user-visible flow | Run `feature-verifier` → `brain verifications add <slug>` (browser walk + screenshots + verdict) |
| New / changed feature | `brain features add` / `set`, then `brain features ship` once verified |
| A decision worth keeping | `brain progress add --summary "..." --body "..."` (or `brain docs set` for a lasting rule) |

## One file, two names

`CLAUDE.md` is a symlink → `AGENTS.md`. Edit `AGENTS.md` only. No mirroring needed — both names resolve to the same file. If you ever see `CLAUDE.md` as a real (non-symlink) file, re-create the symlink: `ln -sf AGENTS.md CLAUDE.md`.

Same trick for the sub-agents: `.kimi-code/agents` is a symlink → [`.claude/agents`](.claude/agents), so [Kimi Code](https://moonshotai.github.io/kimi-code/) (`kimi`) runs the same harness operators Claude Code does — add an agent once, both CLIs see it. Edit `.claude/agents/` only. Caveats (`model:` vs `model_preference`, Claude-only tool names) are in [`.claude/agents/README.md`](.claude/agents/README.md); `./scripts/harness-check.sh` fails if the symlink is gone. Re-create: `mkdir -p .kimi-code && ln -sfn ../.claude/agents .kimi-code/agents`.
