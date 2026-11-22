# Harness reference

Moved out of `AGENTS.md` to keep the always-loaded file small. Agents read this on demand. The rules that bind every agent stay in `AGENTS.md`.

## Working memory

GitHub issues hold the product plan. `context-memory` holds the thread between sessions: one file per feature (`INDEX.md` lists them; `_general.md` holds what spans features). Two modes:

- **recall `<slug | #issue | status>`** — a read-only brief. Safe in parallel; run it at the start of any task, plan or workflow.
- **record `<slug>` + what happened** — merges decisions (dated, with why), links, todos done and new, status, where work stopped and what is next. **One writer:** run it once, at the end, from the main thread or a workflow's last step — never from parallel lanes.

[`scripts/memory.ts`](../../scripts/memory.ts) does the reading and the merging: `bun scripts/memory.ts recall <slug|status>` prints the brief, and `bun scripts/memory.ts record <slug>` merges `key: value` lines from stdin (status, issue, context, log, stopped, waiting, next, decision, link, todo, done) and stamps the date. Workflows call the script through the `runner`. The `context-memory` agent is for words: it turns what you tell it into those fields, answers a question from the brief, and shortens a file the script says is over 150 lines. No model merges the store by hand.

It does not store facts about the code (read the code), what an issue already says (it links the issue), rules (this file), terms (`GLOSSARY.md`) or hard-to-reverse decisions (an ADR it links to).

The store lives in `~/.claude/projects/<repo>/memory/features/` on purpose. A folder inside a checkout forks per worktree and dies with it, and a symlink back to the main checkout is refused by worktree isolation. The auto-memory folder is the one place every worktree shares.

## CodeGraph

[CodeGraph](https://github.com/colbymchenry/codegraph) keeps a symbol graph of the code (functions, types, imports, who calls what) in `.codegraph/`, one per checkout and gitignored. Agents ask it before they grep: one call returns the symbols, their source and their call paths.

- [`scripts/codegraph.sh`](../../scripts/codegraph.sh) runs the installed `codegraph` if it is on PATH, else a pinned copy through `npx`, so a fork needs no install. `npm i -g @colbymchenry/codegraph` makes it faster.
- `init.sh` and the SessionStart hook run `scripts/codegraph.sh ensure`: build the index when it is missing (a new worktree), sync it otherwise. It never fails its caller; with no `codegraph` and no `npx` it warns and agents fall back to `rg`. `CODEGRAPH=0` skips it.
- [`.mcp.json`](../../.mcp.json) starts the MCP server through the same script (`codegraph_explore`, `codegraph_node` and friends); the server watches files and syncs itself. The `UserPromptSubmit` hook adds context only when `codegraph` is installed.
- From a shell: `./scripts/codegraph.sh explore "<q>"`, `node <symbol>`, `status`.
- `context-scout` (plan-feature) and the architect `ship-feature` runs on a ticket with no record start with `explore`.
- Never commit `.codegraph/`: it is a binary SQLite file that changes on every edit.

## Walkthrough videos

Videos a reviewer can watch instead of reading steps. They stay on this machine, in `.verify/<slug>/video/` (gitignored). Two kinds:

- **Smoke videos** come from the committed e2e specs tagged `@golden` and `@error` (`e2e-author` writes one of each per flow). They are the permanent smoke tests: the `e2e` gate runs them on every PR. `bun run test:e2e:videos --out <dir> [spec ...]` ([`scripts/e2e-videos.ts`](../../scripts/e2e-videos.ts)) re-runs them with `E2E_VIDEO=1`, which `playwright.config.ts` reads to record and slow each test, and saves `golden-<title>.webm` and `error-<title>.webm`. A tagged test that leaves no video (skipped, `test.fixme`) fails the run, so a flow nobody filmed cannot drop off the ship page.
- **Demo videos** show what is worth seeing but not worth a test: a tour, a design state, the mobile layout. A throwaway script under `tmp/` calls `record()` from [`scripts/lib/record.ts`](../../scripts/lib/record.ts) with the steps; it saves `demo-<name>.webm`.

`ship-feature` records the smoke videos on the final tree before the ship stop and shows them, with any `demo-*`, on the review page.

## Analytics

[`analytics.md`](analytics.md) — the provider-agnostic `Analytics` service: add an event, add a provider, env vars.

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
- Workflow agents cannot poll the user. A workflow that needs a look stops and returns a `review` page path plus `next`; the main thread writes the page, opens it, polls, then resumes the run. `brand-init` (comp pick, fix acceptance), `plan-feature` (the plan) and `ship-feature` (the pre-push review) do this.
- **Never run `lavish-axi share`.** It uploads the page to ht-ml.app, a third-party host, public by default.

## Design skill install

- **Plugins** — `impeccable` (`impeccable:impeccable`) and the taste skill (`taste-skill:design-taste-frontend`) are enabled in [`.claude/settings.json`](../../.claude/settings.json); Claude Code asks to install them when you trust the repo.
- **Skills without a plugin** — `animate`, `emil-design-eng`, `review-animations` (and the planning skills above) are listed in [`skills-lock.json`](../../skills-lock.json). [`scripts/restore-skills.sh`](../../scripts/restore-skills.sh) installs them on session start and links them into `.claude/skills/`; both directories are gitignored.

An app screen's `impeccable` lanes: `shape` (direction), `critique`, `audit` / `harden` / `polish`. A public page's `design-taste-frontend` lanes: the direction library and the `references/critique.md` loop.

## Workflows

| Workflow | Purpose |
|----------|---------|
| [`plan-feature`](../../.claude/workflows/plan-feature.js) | Turn a GitHub issue (`args.ticket`) or an idea (`args.idea`) into an approved decision record, before any code. `context-scout` reads the working memory, issues, PRs and code; `ticket-auditor` grades the ticket against `PRODUCT.md`; you fill the gaps in chat; the issue is amended (`scripts/tracker.ts`). Then `ticket-auditor` in fit mode (user, job, fit, metric, non-goals) → `ux-planner` ‖ `architect` → `architect` in stack mode (flow diagram, stacked PRs on disjoint fences). For a UI feature `ui-prototyper` draws three rival directions as HTML in the `app/app.css` tokens, `proto-critic` screenshots and critiques each, and you pick one on a lavish page; the winner gets its empty, loading, error and success states. `plan-judge` grades every step against the producer's checklist (one retry, then it asks you). The record (`docs/features/FORMAT.md`, checked by `bun run feature-doc:check`) goes to an issue comment and a working-memory record. Never commits; `ship-feature` builds it. Stops like `brand-init`: `needs-input` (product interview, brief, escalation: chat), `needs-plan` (lavish page `.verify/<slug>/plan-<round>.html`), `needs-accept` (states findings). Re-run with `resumeFromRunId` and `args.product`, `.brief`, `.escalations`, `.plans["<round>"]` or `.accept`. Drafts, pages and screenshots land in `.verify/<slug>/`. Run: `Workflow({ name: "plan-feature", args: { ticket: "#12" } })` or `args: "<idea>"`. |
| [`ship-feature`](../../.claude/workflows/ship-feature.js) | Build, review and open a feature as stacked PRs. Input: an issue with a `plan-feature` record (its contract and PR stack are used as is), an issue the `ticket-auditor` rates ready (the `architect` writes a one-PR contract), or a precise prompt. It runs every gate on the base first, so a gate that was green and is red later is a regression (P0). Then specialist lanes on disjoint fences (`backend-builder`, `ui-builder`), tests, spans and analytics (`instrumenter`), and a parallel review (gates, `effect-ts-enforcer`, `security-reviewer`, `scale-reviewer`, `maintainability-reviewer`, browser walk and design critique); each P0/P1 goes back to the lane that owns the file, two rounds. It stops once (`needs-ship`, lavish page `.verify/<slug>/ship-<round>.html`): nothing is pushed before you approve. Then `scripts/stack.ts` splits the tree into stacked branches by fence and each is checked alone. Each branch is reviewed locally before any push: the `code-review` skill at `high` on its diff against the branch below, `review-responder` fixes or declines each P0/P1, later branches restack, two rounds (`args.reviewRounds`). Then the PRs open with a seeded preview each; with more than one, `review/<slug>` is pushed at the base first and PR 1 targets it. The stacked PRs then merge bottom-up into `review/<slug>` (merge commits; your ship approval covers these merges, never one into the default branch), and one roll-up PR, `review/<slug>` → the default branch, opens for you to test and merge. Greptile reviews the roll-up (or the single PR) only, up to three rounds (`args.rollupRounds`); see [Review loop and merge bar](#review-loop-and-merge-bar). Other stop: `needs-input` (ticket not ready: `args.ready = "override" \| "stop"`). Re-run with `resumeFromRunId` and `args.ships["<round>"] = { approved } \| { approved: false, changes }`. Run: `Workflow({ name: "ship-feature", args: { ticket: "#12" } })` or `args: "<prompt>"`. Phases and args: the header of the script. |
| [`eval-plan-feature`](../../.claude/workflows/eval-plan-feature.js) | Run the `ticket-auditor` over the 20 golden tickets in `evals/plan-feature/` and score them in-script. Run it after any change to the auditor's prompt; the gate is every frozen case passing and ≥ 17/20. `args: { degrade: true }` proves the score can drop. |
| [`brand-init`](../../.claude/workflows/brand-init.js) | Give a fresh fork its own brand, in one run. Interview → three brand directions as live comps → you pick → tokens, fonts, every primitive and the shared components redesigned → one PR. Agents in a workflow can't talk to you, so when it needs you it stops and returns `{ status: "needs-input" | "needs-pick" | "needs-accept", ... }`; the main thread asks you — the brief in chat, the comp pick and fix acceptance on a lavish review page — then re-runs with `resumeFromRunId: "<run id>"` and the answer in `args` (`answers`, `pick` + `rebuildHome`, or `accept`). Comps and screenshots land in `.verify/brand-init/`. Refuses if `DESIGN.md` exists unless you pass `redo: true`. Run: `Workflow({ name: "brand-init", args: { brief: "..." } })`. |

### Editing a workflow

A workflow script is one body the runtime runs: it cannot import a file. So the scripts in `.claude/workflows/` are built, and you edit their sources.

- **Source:** `.claude/workflow-src/<name>.js`. The helpers every workflow shares live in [`.claude/workflow-src/lib.js`](../../.claude/workflow-src/lib.js). One `// @lib` line in each source marks where the build pastes the library.
- **Build:** `bun scripts/workflows.ts build` writes `.claude/workflows/<name>.js`. Commit the source and the built file together. Never edit a built file: the `harness` gate runs `bun scripts/workflows.ts check` and fails when one differs from its source.
- **Test:** `scripts/__tests__/workflows/<name>.test.ts` runs each built script with scripted agents, through `dryRun(name, { args, answers, resumeFrom })` in [`scripts/lib/workflow-dry-run.ts`](../../scripts/lib/workflow-dry-run.ts). No model is called, so they run in the `test` gate. An agent call no rule answers fails the run; so does an answer its schema rejects. Each workflow has a happy path, a failing gate, a stop and resume, and a fix round. Add a case when you add a branch.
- **Prove an edit changed no prompt:** `WORKFLOW_DRY_RUN_TRACE=<file>` appends every dry run (each prompt, opts, log line and result) as one JSON line. Trace `bunx vitest run scripts/__tests__/workflows` before the edit and after the rebuild, then `diff <(sort before.jsonl) <(sort after.jsonl)`. `WORKFLOW_DRY_RUN_DIR=<dir>` points the tests at a build made with `build --out <dir>`.
- **What a dry run does not show:** how the real runtime finds cached results on resume (the harness replays call by call, in order), and anything an agent would do with a prompt. A change to what a prompt asks for still needs one real run.

## Review loop and merge bar

`ship-feature` reviews stacked PRs on this machine and spends Greptile on one PR per feature: the roll-up, or the single PR when there is one. Per feature that is 1-3 Greptile reviews. Before this, every stacked PR was reviewed by the Greptile CLI before push, then by Greptile on GitHub, and re-scored after every rebase: on Sola in November 2026, six features of 8-11 stacked PRs each cost 30+ Greptile reviews per feature, mostly of code already reviewed, and days of approvals.

1. **Whole tree** (Review phase): gates, `effect-ts-enforcer`, `security-reviewer`, `scale-reviewer`, `maintainability-reviewer`, browser walk, design critique. Each P0/P1 goes back to the lane that owns the file.
2. **Each stacked branch** (Local review, before any push): the `code-review` skill at `high` on `git diff <branch below>...<branch>`, without `--comment` or `--fix`. `review-responder` fixes or declines each P0/P1 inside the branch's fence; the branches above restack and re-run typecheck and unit tests. Two rounds, or until a round has no P0/P1. P2/P3 findings are kept in the result as advisory.
3. **The roll-up** (Roll-up Greptile): one `@greptileai review`. `scripts/pr-review-wait.ts` counts a review only when it names the PR's current head (a clean review is Greptile's completed check plus a summary whose "Last reviewed commit" is the head); a timeout is a stop, not a pass. The stacked PRs are already merged into `review/<slug>`, so each fix is a new commit there, made inside the fence of the stacked PR that owns the file. Each round's GitHub writes (pushes, thread replies, the next trigger) run in one step, so you approve them once a round. Three rounds, to 5/5 or every remaining comment declined with a reason.

After the first push no branch is rewritten: `.claude/settings.json` denies `git push --force`, which also blocks `--force-with-lease`, so every push is a fast-forward. Roll-up fixes are new commits on `review/<slug>`.

**Merge bar**

1. `./scripts/verify.sh` green on the top branch with a freshly seeded DB (`bun run db:seed`); typecheck and unit tests green on every branch alone.
2. Local reviews (code-review, security, scale, maintainability, `effect-ts-enforcer`): no open P0/P1.
3. Greptile 5/5 on the roll-up's current head, or each remaining comment declined with a reason. The 5/5 bar applies to the roll-up head only, never to the stacked PRs.
4. You (or a coordinator you authorized) squash-merge the roll-up with `gh pr merge <n> --squash --match-head-commit <reviewed sha>`. `ship-feature` prints the command with the sha Greptile reviewed. The stacked PRs already show Merged (into `review/<slug>`), so nothing is left to close.

Commit subjects and PR titles follow Conventional Commits, checked by the `commit-msg` hook and the PR title job; the rule and the titles of the roll-up and release PRs are in [Commit subjects and PR titles](../ci/pipelines.md#commit-subjects-and-pr-titles).

**Greptile settings (dashboard, by hand).** Set Greptile to review only when mentioned, so stacked PRs never trigger automatic reviews; the workflow posts `@greptileai review` on the roll-up itself, so an automatic review when the roll-up opens would be a second, wasted one. This is a setting in the Greptile dashboard, not a file in this repo.

**When another feature merges first.** The stack is already in `review/<slug>`, so merge the default branch into it (`bun scripts/default-branch.ts` prints it; `staging` today); no rebase, no force push, and no re-review of the stacked PRs:

- `git switch review/<slug>`, then `git merge "origin/$(bun scripts/default-branch.ts)"`. Migrations and ADRs: renumber yours to follow its latest. `scripts/seed-preview.ts` and `GLOSSARY.md`: keep both sides.
- Re-run typecheck and unit tests, and e2e after `bun run db:seed`: the e2e server migrates but does not seed.
- `git push origin review/<slug>` (a fast-forward), then post `@greptileai review` on the roll-up. The squash merge folds the merge commit away.

**Fresh worktrees.** A `node_modules/node_modules` symlink to the main checkout breaks tests ("Invalid hook call", Playwright "No tests found"). `ship-feature`'s preflight moves it aside in a linked worktree; elsewhere, `mv node_modules/node_modules node_modules/.nested-modules-aside`.

## Slash commands

| Command | Purpose |
|---------|---------|
| [`/harness-check`](../../.claude/commands/harness-check.md) | [`scripts/harness-check.sh`](../../scripts/harness-check.sh) — CLAUDE↔AGENTS symlink, sub-agent frontmatter, Kimi roster symlink, hook wiring + hook tests, workflow scripts (they parse, and match their sources), the generated lint rules page, and the live repo rules against `.github/repo-rules.json` ([`docs/ci/repo-rules.md`](../ci/repo-rules.md); a notice when GitHub cannot be read). No LLM, exits non-zero on drift. |

## Gates

Listed in [`scripts/verify.sh`](../../scripts/verify.sh), the one runner for CI, `init.sh` and agents:

| Gate | Command | Runs in |
|------|---------|---------|
| typecheck | `bun run typecheck` | baseline, full |
| test | `bun run test` | baseline, full |
| non-negotiables-selftest | `bun run scripts/check-non-negotiables.ts --selftest` | baseline, full |
| non-negotiables | `bun run scripts/check-non-negotiables.ts` | baseline, full |
| migrations | `bun run scripts/migration-check.ts` | baseline, full |
| harness | `./scripts/harness-check.sh` | baseline, full |
| secrets | `bun run scripts/secret-scan.ts` | baseline, full |
| audit | `bun run scripts/package-audit.ts` | baseline, full |
| build | `bun run build` | full |
| e2e | `bun run test:e2e` | full |

`./scripts/verify.sh` runs the full set, `--baseline` the quick set, `--only <gate>` one gate, `--list` prints them. To add a gate, add a line to `GATES` in `scripts/verify.sh` — CI picks it up.

The two `non-negotiables` gates run the house linter (`bun run lint:house`): one file per rule in `scripts/lint/rules/`, findings that say the fix, and a baseline that only shrinks. The rules, the baseline and how to add a rule: [`lint-rules.md`](lint-rules.md).

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
bun run lint:house [files] # House lint rules: the named files, or the whole repo (--rules lists them)
bun run test:e2e          # Playwright e2e tests
bun run test:e2e:videos --out <dir>  # Record the @golden/@error specs as PR videos
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
