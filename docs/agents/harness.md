# Harness reference

Moved out of `AGENTS.md` to keep the always-loaded file small. Agents read this on demand. The rules that bind every agent stay in `AGENTS.md`.

## Working memory

GitHub issues hold the product plan. `context-memory` holds the thread between sessions: one file per feature (`INDEX.md` lists them; `_general.md` holds what spans features). Two modes:

- **recall `<slug | #issue | topic | status>`** — a read-only brief. Safe in parallel; run it at the start of any task, plan or workflow.
- **record `<slug>` + what happened** — merges decisions (dated, with why), links, todos done and new, status, where work stopped and what is next. **One writer:** run it once, at the end, from the main thread or a workflow's last step — never from parallel lanes.

It does not store facts about the code (read the code), what an issue already says (it links the issue), rules (this file), terms (`GLOSSARY.md`) or hard-to-reverse decisions (an ADR it links to).

The store lives in `~/.claude/projects/<repo>/memory/features/` on purpose. A folder inside a checkout forks per worktree and dies with it, and a symlink back to the main checkout is refused by worktree isolation. The auto-memory folder is the one place every worktree shares.

## CodeGraph

[CodeGraph](https://github.com/colbymchenry/codegraph) keeps a symbol graph of the code (functions, types, imports, who calls what) in `.codegraph/`, one per checkout and gitignored. Agents ask it before they grep: one call returns the symbols, their source and their call paths.

- [`scripts/codegraph.sh`](../../scripts/codegraph.sh) runs the installed `codegraph` if it is on PATH, else a pinned copy through `npx`, so a fork needs no install. `npm i -g @colbymchenry/codegraph` makes it faster.
- `init.sh` and the SessionStart hook run `scripts/codegraph.sh ensure`: build the index when it is missing (a new worktree), sync it otherwise. It never fails its caller; with no `codegraph` and no `npx` it warns and agents fall back to `rg`. `CODEGRAPH=0` skips it.
- [`.mcp.json`](../../.mcp.json) starts the MCP server through the same script (`codegraph_explore`, `codegraph_node` and friends); the server watches files and syncs itself. The `UserPromptSubmit` hook adds context only when `codegraph` is installed.
- From a shell: `./scripts/codegraph.sh explore "<q>"`, `node <symbol>`, `status`.
- `context-scout` (plan-feature) and the nearest-feature lane of `build-feature` start with `explore`.
- Never commit `.codegraph/`: it is a binary SQLite file that changes on every edit.

## Planning skills

Planning uses Matt Pocock's [skills](https://github.com/mattpocock/skills), listed in [`skills-lock.json`](../../skills-lock.json). They run only when you type them.

- `/grill-me`: a numbered interview, one round per set of open questions, each with a recommended answer.
- `/grill-with-docs`: the same, and it writes `GLOSSARY.md` and ADRs as terms and decisions settle.
- `/to-spec`: writes the spec as a GitHub issue.
- `/to-tickets`: breaks the spec into vertical slices, each a thin path through schema, API, UI and tests, with blocking issues linked.

Record the decisions and the issue numbers with `context-memory`.

## Review in the browser

[lavish](https://github.com/kunchenguid/lavish-axi) (the `lavish` skill, in `skills-lock.json`) opens an HTML page in the browser, lets the user click any element or select text to leave a note, and long-polls the notes back to the agent. Use it when the user must judge something they need to see: a comp pick, findings with screenshots, a build result, a plan with a diagram. Ask in chat when the answer is words.

- Write the page, then `npx -y lavish-axi <page>` and `npx -y lavish-axi poll <page>` in the foreground; re-run the poll if it times out. `npx -y lavish-axi --help` and `playbook <id>` hold the current rules. Style pages with the tokens in `app/app.css`.
- Workflow agents cannot poll the user. A workflow that needs a look stops and returns a `review` page path plus `next`; the main thread writes the page, opens it, polls, then resumes the run. `brand-init` (comp pick, fix acceptance) and `build-feature` (the result) do this.
- **Never run `lavish-axi share`.** It uploads the page to ht-ml.app, a third-party host, public by default.

## Design skill install

- **Plugins** — `impeccable` (`impeccable:impeccable`) and the taste skill (`taste-skill:design-taste-frontend`) are enabled in [`.claude/settings.json`](../../.claude/settings.json); Claude Code asks to install them when you trust the repo.
- **Skills without a plugin** — `animate`, `emil-design-eng`, `review-animations` (and the planning skills above) are listed in [`skills-lock.json`](../../skills-lock.json). [`scripts/restore-skills.sh`](../../scripts/restore-skills.sh) installs them on session start and links them into `.claude/skills/`; both directories are gitignored.

An app screen's `impeccable` lanes: `shape` (direction), `critique`, `audit` / `harden` / `polish`. A public page's `design-taste-frontend` lanes: the direction library and the `references/critique.md` loop.

## Workflows

| Workflow | Purpose |
|----------|---------|
| [`plan-feature`](../../.claude/workflows/plan-feature.js) | Turn a GitHub issue (`args.ticket`) or an idea (`args.idea`) into an approved decision record, before any code. `context-scout` reads the working memory, issues, PRs and code; `ticket-auditor` grades the ticket against `PRODUCT.md`; you fill the gaps in chat; the issue is amended (`scripts/tracker.ts`). Then `product-strategist` → `ux-planner` ‖ `architect` → `stack-planner` (flow diagram, stacked PRs on disjoint fences). For a UI feature `ui-prototyper` draws three rival directions as HTML in the `app/app.css` tokens, `proto-critic` screenshots and critiques each, and you pick one on a lavish page; the winner gets its empty, loading, error and success states. `plan-judge` grades every step against the producer's `## Checklist` (one retry, then it asks you). The record (`docs/features/FORMAT.md`, checked by `bun run feature-doc:check`) goes to an issue comment and a `context-memory` record. Never commits; `/build-feature` builds it. Stops like `brand-init`: `needs-input` (product interview, brief, escalation: chat), `needs-plan` (lavish page `.verify/<slug>/plan-<round>.html`), `needs-accept` (states findings). Re-run with `resumeFromRunId` and `args.product`, `.brief`, `.escalations`, `.plans["<round>"]` or `.accept`. Drafts, pages and screenshots land in `.verify/<slug>/`. Run: `Workflow({ name: "plan-feature", args: { ticket: "#12" } })` or `args: "<idea>"`. |
| [`eval-plan-feature`](../../.claude/workflows/eval-plan-feature.js) | Run the `ticket-auditor` over the 20 golden tickets in `evals/plan-feature/` and score them in-script. Run it after any change to the auditor's prompt; the gate is every frozen case passing and ≥ 17/20. `args: { degrade: true }` proves the score can drop. |
| [`brand-init`](../../.claude/workflows/brand-init.js) | Give a fresh fork its own brand, in one run. Interview → three brand directions as live comps → you pick → tokens, fonts, all 55 primitives and the shared components redesigned → one PR. Agents in a workflow can't talk to you, so when it needs you it stops and returns `{ status: "needs-input" | "needs-pick" | "needs-accept", ... }`; the main thread asks you — the brief in chat, the comp pick and fix acceptance on a lavish review page — then re-runs with `resumeFromRunId: "<run id>"` and the answer in `args` (`answers`, `pick` + `rebuildHome`, or `accept`). Comps and screenshots land in `.verify/brand-init/`. Refuses if `DESIGN.md` exists unless you pass `redo: true`. Run: `Workflow({ name: "brand-init", args: { brief: "..." } })`. |

## Slash commands

| Command | Purpose |
|---------|---------|
| [`/build-feature`](../../.claude/commands/build-feature.md) | Multi-layer feature build with the sub-agents **fanned out in parallel** — orient → fix the contract (the one sequential step) → build lanes on **disjoint paths** → tests ‖ spans, then verify lanes at once (gates · non-negotiables · browser walk · design critique) → synthesis. Does not commit, does not decide for you. |
| [`/harness-check`](../../.claude/commands/harness-check.md) | [`scripts/harness-check.sh`](../../scripts/harness-check.sh) — CLAUDE↔AGENTS symlink, sub-agent frontmatter, Kimi roster symlink, hook wiring + hook tests, workflow scripts. Deterministic, no LLM, exits non-zero on drift. |

## Gates

Listed in [`scripts/verify.sh`](../../scripts/verify.sh), the one runner for CI, `init.sh` and agents:

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

## Commands (README.md has the same list)

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

## One file, two names

`CLAUDE.md` is a symlink → `AGENTS.md`. Edit `AGENTS.md` only. No mirroring needed — both names resolve to the same file. If you ever see `CLAUDE.md` as a real (non-symlink) file, re-create the symlink: `ln -sf AGENTS.md CLAUDE.md`.

Same trick for the sub-agents: `.kimi-code/agents` is a symlink → [`.claude/agents`](../../.claude/agents), so [Kimi Code](https://moonshotai.github.io/kimi-code/) (`kimi`) runs the same harness operators Claude Code does — add an agent once, both CLIs see it. Edit `.claude/agents/` only. Caveats (`model:` vs `model_preference`, Claude-only tool names) are in [`.claude/agents/README.md`](../../.claude/agents/README.md); `./scripts/harness-check.sh` fails if the symlink is gone. Re-create: `mkdir -p .kimi-code && ln -sfn ../.claude/agents .kimi-code/agents`.
