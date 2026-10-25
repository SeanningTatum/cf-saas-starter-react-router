# AGENTS.md

> This is the single source of truth. `CLAUDE.md` is a symlink to this file, so Claude Code, Cursor, Codex, Aider all read the same content. **Edit `AGENTS.md` only** — never replace the symlink with a real file. Work is tracked in GitHub issues.

## Overview

SaaS starter on **Cloudflare Workers + React Router v7 + tRPC + D1/Drizzle + Better Auth + Effect TS + ShadCN/Tailwind**. Email/password auth, admin dashboard, file upload (R2), analytics, i18n, dark mode.

> **Retrieval over recall.** Read the issue, the feature's working memory (`context-memory` recall), `GLOSSARY.md` and `docs/adr/` before any task. Do not rely on training data for project state.

## Where things live

| What | Where |
|------|-------|
| Work to do, specs, tickets | GitHub issues — see [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md). `gh issue list --label ready-for-agent` lists what an agent can pick up. |
| Domain terms | `GLOSSARY.md` at the root (created by `/grill-with-docs` when the first term settles) |
| Decisions that are hard to reverse | `docs/adr/NNNN-<slug>.md` — see [`docs/agents/domain.md`](docs/agents/domain.md) |
| Lasting rules for agents | this file |
| Proof a flow works | `.verify/<slug>/` (screenshots + `verdict.md`, gitignored), pasted into the PR |
| Pages a human reviews (comp picks, build results, plans) | `.verify/<slug>/*.html` or `.lavish/`, both gitignored, opened with lavish — see [Review in the browser](#review-in-the-browser) |
| Working memory — per feature: context, decisions and why, links and tickets, todo list, where work stopped | The [`context-memory`](.claude/agents/context-memory.md) agent's store, outside the repo (`./scripts/memory-dir.sh` prints it). Local to this machine, shared by every worktree. Your auto-memory `MEMORY.md` carries one line pointing at it. |

### Working memory

GitHub issues hold the product plan. `context-memory` holds the thread between sessions: one file per feature (`INDEX.md` lists them; `_general.md` holds what spans features). Two modes:

- **recall `<slug | #issue | topic | status>`** — a read-only brief. Safe in parallel; run it at the start of any task, plan or workflow.
- **record `<slug>` + what happened** — merges decisions (dated, with why), links, todos done and new, status, where work stopped and what is next. **One writer:** run it once, at the end, from the main thread or a workflow's last step — never from parallel lanes.

It does not store facts about the code (read the code), what an issue already says (it links the issue), rules (this file), terms (`GLOSSARY.md`) or hard-to-reverse decisions (an ADR it links to).

The store lives in `~/.claude/projects/<repo>/memory/features/` on purpose. A folder inside a checkout forks per worktree and dies with it, and a symlink back to the main checkout is refused by worktree isolation. The auto-memory folder is the one place every worktree shares.

## Workflow

Planning uses Matt Pocock's [skills](https://github.com/mattpocock/skills), listed in [`skills-lock.json`](skills-lock.json). They run only when you type them.

1. **Start:** `context-memory` recall for the feature, read the issue (`gh issue view <n>`), run `./scripts/verify.sh --baseline`. If it is red, stop and say so before changing anything.
2. **Plan** (when a decision is involved): `/grill-me` — a numbered interview, one round per set of open questions, each with a recommended answer. `/grill-with-docs` does the same and writes `GLOSSARY.md` and ADRs as terms and decisions settle. Then `/to-spec` writes the spec as a GitHub issue, and `/to-tickets` breaks it into vertical slices — each issue a thin path through schema, API, UI and tests, with its blocking issues linked. Record the decisions and the issue numbers with `context-memory`.
3. **Work:** one ticket at a time. Delegate the lanes to sub-agents in parallel (below).
4. **Verify:** spawn `feature-verifier` for a browser walk of any user-visible flow; it writes `.verify/<slug>/verdict.md`.
5. **Done:** `./scripts/verify.sh` green, a PASS verdict in the PR description, the PR closes the issue (`Closes #<n>`), and one `context-memory` record for the feature.

For trivial edits (typo, comment, one-line change), skip the bookends — but never skip `./scripts/verify.sh` on user-visible work.

## Agent skills

### Issue tracker

GitHub issues, through the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.

### Review in the browser

[lavish](https://github.com/kunchenguid/lavish-axi) (the `lavish` skill, in `skills-lock.json`) opens an HTML page in the browser, lets the user click any element or select text to leave a note, and long-polls the notes back to the agent. Use it when the user must judge something they need to see: a comp pick, findings with screenshots, a build result, a plan with a diagram. Ask in chat when the answer is words.

- Write the page, then `npx -y lavish-axi <page>` and `npx -y lavish-axi poll <page>` in the foreground; re-run the poll if it times out. `npx -y lavish-axi --help` and `playbook <id>` hold the current rules. Style pages with the tokens in `app/app.css`.
- Workflow agents cannot poll the user. A workflow that needs a look stops and returns a `review` page path plus `next`; the main thread writes the page, opens it, polls, then resumes the run. `brand-init` (comp pick, fix acceptance) and `build-feature` (the result) do this.
- **Never run `lavish-axi share`.** It uploads the page to ht-ml.app, a third-party host, public by default.

## Delegate in parallel

Any change beyond one file runs as parallel sub-agents, not one long sequential thread. Most of a feature's order is a compile dependency, not an information one: once the interface is fixed, the server work and the UI work need nothing from each other.

1. **Fix the contract** — types, procedure signatures, and which lane owns which paths. The only sequential step.
2. **Build lanes, one message** — one `Agent` call per lane, all sent together: data (schema + repository + its tests) · api (tRPC procedure + its tests) · UI (`ui-builder`). Each lane owns disjoint paths; a lane that needs a file it does not own stops and reports.
3. **Writer wave** — `test-author` ‖ `span-instrumenter`. Tests and spans touch different files, so they run together.
4. **Checker wave** — `effect-ts-enforcer` ‖ `feature-verifier` ‖ design critique ‖ `./scripts/verify.sh`. All read-only, all need the finished tree. Each browser lane owns its port (`CI=1 bun run dev --port <free>`).
5. **Converge** — the main thread reads every report, re-dispatches the owning agent for each P0/P1, then runs the Done step above (its one `context-memory` record included). Lanes never record themselves.

A multi-layer feature can run all of this as one workflow with [`/build-feature`](.claude/commands/build-feature.md). Stay sequential for a one-file change, an interface you do not know yet, a red baseline, or two lanes that need the same file.

## Workflows

| Workflow | Purpose |
|----------|---------|
| [`brand-init`](.claude/workflows/brand-init.js) | Give a fresh fork its own brand, in one run. Interview → three brand directions as live comps → you pick → tokens, fonts, all 55 primitives and the shared components redesigned → one PR. Agents in a workflow can't talk to you, so when it needs you it stops and returns `{ status: "needs-input" | "needs-pick" | "needs-accept", ... }`; the main thread asks you — the brief in chat, the comp pick and fix acceptance on a lavish review page — then re-runs with `resumeFromRunId: "<run id>"` and the answer in `args` (`answers`, `pick` + `rebuildHome`, or `accept`). Comps and screenshots land in `.verify/brand-init/`. Refuses if `DESIGN.md` exists unless you pass `redo: true`. Run: `Workflow({ name: "brand-init", args: { brief: "..." } })`. |

## Slash commands

| Command | Purpose |
|---------|---------|
| [`/build-feature`](.claude/commands/build-feature.md) | Multi-layer feature build with the sub-agents **fanned out in parallel** — orient → fix the contract (the one sequential step) → build lanes on **disjoint paths** → tests ‖ spans, then verify lanes at once (gates · non-negotiables · browser walk · design critique) → synthesis. Does not commit, does not decide for you. |
| [`/harness-check`](.claude/commands/harness-check.md) | [`scripts/harness-check.sh`](scripts/harness-check.sh) — CLAUDE↔AGENTS symlink, sub-agent frontmatter, Kimi roster symlink, hook wiring + hook tests, workflow scripts. Deterministic, no LLM, exits non-zero on drift. |

## Gates

Listed in [`scripts/verify.sh`](scripts/verify.sh), the one runner for CI, `init.sh` and agents:

| Gate | Command | Runs in |
|------|---------|---------|
| typecheck | `bun run typecheck` | baseline, full |
| test | `bun run test` | baseline, full |
| non-negotiables-selftest | `bun run scripts/check-non-negotiables.ts --selftest` | baseline, full |
| non-negotiables | `bun run scripts/check-non-negotiables.ts` | baseline, full |
| harness | `./scripts/harness-check.sh` | baseline, full |
| build | `bun run build` | full |
| e2e | `bun run test:e2e` | full |

`./scripts/verify.sh` runs the full set, `--baseline` the quick set, `--only <gate>` one gate, `--list` prints them. To add a gate, add a line to `GATES` in `scripts/verify.sh` — CI picks it up.

## Scope policy

- **One ticket in progress at a time.** Assign yourself (`gh issue edit <n> --add-assignee @me`) when you start it.
- **Definition of done:** implementation complete + `./scripts/verify.sh` green + a PASS verdict from `feature-verifier` (for user-visible work) in the PR + the PR closes the issue.
- **Scope creep guardrail:** if you touch >2 tickets in one diff, stop and split. A cross-feature refactor is a separate ticket.

## Frontend tasks — load a design skill every time

Any task that changes what a user sees loads at least one of these skills before the first UI edit. Each owns a lane, so never run both leads on one surface. Nothing here is a committed copy:

- **Plugins** — `impeccable` (`impeccable:impeccable`) and the taste skill (`taste-skill:design-taste-frontend`) are enabled in [`.claude/settings.json`](.claude/settings.json); Claude Code asks to install them when you trust the repo.
- **Skills without a plugin** — `animate`, `emil-design-eng`, `review-animations` (and the planning skills above) are listed in [`skills-lock.json`](skills-lock.json). [`scripts/restore-skills.sh`](scripts/restore-skills.sh) installs them on session start and links them into `.claude/skills/`; both directories are gitignored.


| Lane | Skill |
|------|-------|
| Direction — tier-2 surfaces (net-new or redesign), before any JSX | the lead's own: `impeccable` `shape` (app screens) · `design-taste-frontend` direction library (public pages) |
| Lead — app screens (dashboard, admin, settings, tables, forms, states) | `impeccable` |
| Lead — public pages (landing, marketing, pricing, hero) | `design-taste-frontend` |
| Critique — the render, before `./scripts/verify.sh` | the lead's own: `impeccable` `critique` (app screens) · `design-taste-frontend` `references/critique.md` loop (public pages) |
| Finish pass before `./scripts/verify.sh`, any surface | `impeccable` `audit` / `harden` / `polish` |
| Motion — anything that moves | `emil-design-eng` + `animate` (build) · `/review-animations` (critique) |

A fresh fork runs the `brand-init` workflow first. After it, every UI agent reads `PRODUCT.md` and `DESIGN.md` before its first edit.

**The critique gates the work.** Judge screenshots at desktop and mobile, not the source. App screens: fix every `impeccable` P0/P1, then critique again. Public pages: run the taste loop up to three rounds; a page still under 7.5 is reported as such, never rounded up. Paste the last critique into the verdict. Typecheck, tests and the browser walk all pass on a templated page; only the critique fails a design for being generic.

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
gh issue list --label ready-for-agent  # Work an agent can pick up
./scripts/verify.sh       # Run every gate (--baseline for the quick set, --list to see them)
./scripts/harness-check.sh # Harness invariants (symlinks, sub-agent frontmatter, hooks, workflows)
./init.sh                 # Harness bootstrap — install + skills + migrate + typecheck + test (run start of session)
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
| New / changed user-visible flow | Run `feature-verifier` → `.verify/<slug>/verdict.md` (browser walk + screenshots + verdict), pasted into the PR |
| New / changed feature | A GitHub issue (`/to-spec`, then `/to-tickets`); the PR that ships it closes it |
| A new domain term | `GLOSSARY.md` (`/grill-with-docs` writes it as you go) |
| A decision worth keeping | `context-memory` record (dated, with why); also an ADR in `docs/adr/` if it is hard to reverse; a rule for agents goes in this file |
| Stopping mid-feature | `context-memory` record: where you stopped, what is next, open todos |

## One file, two names

`CLAUDE.md` is a symlink → `AGENTS.md`. Edit `AGENTS.md` only. No mirroring needed — both names resolve to the same file. If you ever see `CLAUDE.md` as a real (non-symlink) file, re-create the symlink: `ln -sf AGENTS.md CLAUDE.md`.

Same trick for the sub-agents: `.kimi-code/agents` is a symlink → [`.claude/agents`](.claude/agents), so [Kimi Code](https://moonshotai.github.io/kimi-code/) (`kimi`) runs the same harness operators Claude Code does — add an agent once, both CLIs see it. Edit `.claude/agents/` only. Caveats (`model:` vs `model_preference`, Claude-only tool names) are in [`.claude/agents/README.md`](.claude/agents/README.md); `./scripts/harness-check.sh` fails if the symlink is gone. Re-create: `mkdir -p .kimi-code && ln -sfn ../.claude/agents .kimi-code/agents`.
