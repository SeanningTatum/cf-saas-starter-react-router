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

## Project settings

[`harness-config.md`](harness-config.md): `harness.config.json`, the one file of values that belong to a project (the gate list, the review bot, the ready label, the seeded logins, the paths). It stays in the project when the harness is synced.

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
| [`plan-feature`](../../.claude/workflows/plan-feature.js) | Turn a GitHub issue (`args.ticket`) or an idea (`args.idea`) into an approved decision record, before any code. `context-scout` reads the working memory, issues, PRs and code; `ticket-auditor` grades the ticket against `PRODUCT.md`; you fill the gaps in chat; the issue is amended (`scripts/tracker.ts`). Then `ticket-auditor` in fit mode (user, job, fit, metric, non-goals) → `ux-planner` ‖ `architect` → `architect` in stack mode (flow diagram, stacked PRs on disjoint fences). For a UI feature `ui-prototyper` draws three rival directions as HTML in the project's tokens file (`paths.tokens`), `proto-critic` screenshots and critiques each, and you pick one on a lavish page; the winner gets its empty, loading, error and success states. `plan-judge` grades every step against the producer's checklist (one retry, then it asks you). The record (`docs/features/FORMAT.md`, checked by `bun run feature-doc:check`) goes to an issue comment and a working-memory record. Never commits; `ship-feature` builds it. Stops like `brand-init`: `needs-input` (product interview, brief, escalation: chat), `needs-plan` (lavish page `.verify/<slug>/plan-<round>.html`), `needs-accept` (states findings). Re-run with `resumeFromRunId` and `args.product`, `.brief`, `.escalations`, `.plans["<round>"]` or `.accept`. Drafts, pages and screenshots land in `.verify/<slug>/`. Run: `Workflow({ name: "plan-feature", args: { ticket: "#12" } })` or `args: "<idea>"`. |
| [`ship-feature`](../../.claude/workflows/ship-feature.js) | Build, review and open a feature as stacked PRs. Input: an issue with a `plan-feature` record (its contract and PR stack are used as is), an issue the `ticket-auditor` rates ready (the `architect` writes a one-PR contract), or a precise prompt. It runs every gate on the base first, so a gate that was green and is red later is a regression (P0). Then specialist lanes on disjoint fences (`backend-builder`, `ui-builder`), tests, spans and analytics (`instrumenter`), and a parallel review (gates, `effect-ts-enforcer`, `security-reviewer`, `scale-reviewer`, `maintainability-reviewer`, browser walk and design critique); each P0/P1 goes back to the lane that owns the file, two rounds. It stops once (`needs-ship`, lavish page `.verify/<slug>/ship-<round>.html`): nothing is pushed before you approve. Then `scripts/stack.ts` splits the tree into stacked branches by fence and each is checked alone with `./scripts/verify.sh --changed <branch below>`. Each branch is reviewed locally before any push: the `code-review` skill at `high` on its diff against the branch below, `review-responder` fixes or declines each P0/P1, later branches restack, one round (`args.reviewRounds`). Then the PRs open; a stacked PR gets CI's lean job and no preview; with more than one, `review/<slug>` is pushed at the base first and PR 1 targets it. The stacked PRs then merge bottom-up into `review/<slug>` (merge commits; your ship approval covers these merges, never one into the default branch), and one roll-up PR, `review/<slug>` → the default branch, opens for you to test and merge. Greptile reviews the roll-up (or the single PR) only, up to three rounds (`args.rollupRounds`); see [Review loop and merge bar](#review-loop-and-merge-bar). Other stop: `needs-input` (ticket not ready: `args.ready = "override" \| "stop"`). Re-run with `resumeFromRunId` and `args.ships["<round>"] = { approved } \| { approved: false, changes }`. Run: `Workflow({ name: "ship-feature", args: { ticket: "#12" } })` or `args: "<prompt>"`. Phases and args: the header of the script. |
| [`eval-plan-feature`](../../.claude/workflows/eval-plan-feature.js) | Run the `ticket-auditor` over the 20 golden tickets in `evals/plan-feature/` and score them in-script. Run it after any change to the auditor's prompt; the gate is every frozen case passing and ≥ 17/20. `args: { degrade: true }` proves the score can drop. If it stops with "loaded metadata differs from the files on disk", fix the files and re-run with `resumeFromRunId` and `args: { reload: 1 }` (then 2, and so on): the number goes into the Load prompt, so the loader runs again instead of replaying its old answer. |
| [`brand-init`](../../.claude/workflows/brand-init.js) | Give a fresh fork its own brand, in one run. Interview → three brand directions as live comps → you pick → tokens, fonts, every primitive and the shared components redesigned → one PR. Agents in a workflow can't talk to you, so when it needs you it stops and returns `{ status: "needs-input" | "needs-pick" | "needs-accept", ... }`; the main thread asks you — the brief in chat, the comp pick and fix acceptance on a lavish review page — then re-runs with `resumeFromRunId: "<run id>"` and the answer in `args` (`answers`, `pick` + `rebuildHome`, or `accept`). Comps and screenshots land in `.verify/brand-init/`. Refuses if `DESIGN.md` exists unless you pass `redo: true`. Run: `Workflow({ name: "brand-init", args: { brief: "..." } })`. |

### Editing a workflow

A workflow script is one body the runtime runs: it cannot import a file. So the scripts in `.claude/workflows/` are built, and you edit their sources.

- **Source:** `.claude/workflow-src/<name>.js`. The helpers every workflow shares live in [`.claude/workflow-src/lib.js`](../../.claude/workflow-src/lib.js). One `// @lib` line in each source marks where the build pastes the library.
- **Project values:** a source holds none of its own. A path, a doc name, the base branch, the review bot's trigger, the co-author line, the shared-file owners and brand-init's lanes are `cfg.<key>`, read from [`harness.config.json`](harness-config.md): each workflow's first call, `config`, returns `bun scripts/harness-config.ts show` as `config_json`, and `readConfig` in `lib.js` verifies its checksum (how it works: [`harness-config.md`](harness-config.md)). A literal path under `app/` in harness code fails `harness-check.sh` check N.
- **Build:** `bun scripts/workflows.ts build` writes `.claude/workflows/<name>.js`. Commit the source and the built file together. Never edit a built file: the `harness` gate runs `bun scripts/workflows.ts check` and fails when one differs from its source.
- **Test:** `scripts/__tests__/workflows/<name>.test.ts` runs each built script with scripted agents, through `dryRun(name, { args, answers, resumeFrom })` in [`scripts/lib/workflow-dry-run.ts`](../../scripts/lib/workflow-dry-run.ts). The `config` answer carries `config_json`: `configLine()` from the same file builds it from the real `harness.config.json` (pass a function to change the config), and each workflow's happy-path answers sit in `<name>.fixtures.ts` beside its test. `config.test.ts` drives the three workflows with a changed config. No model is called, so they run in the `test` gate. An agent call no rule answers fails the run; so does an answer its schema rejects. Each workflow has a happy path, a failing gate, a stop and resume, and a fix round. Add a case when you add a branch.
- **Prove an edit changed no prompt:** `WORKFLOW_DRY_RUN_TRACE=<file>` appends every dry run (each prompt, opts, log line and result) as one JSON line. Trace `bunx vitest run scripts/__tests__/workflows` before the edit and after the rebuild, then `diff <(sort before.jsonl) <(sort after.jsonl)`. `WORKFLOW_DRY_RUN_DIR=<dir>` points the tests at a build made with `build --out <dir>`.
- **What a dry run does not show:** how the real runtime finds cached results on resume (the harness replays call by call, in order), and anything an agent would do with a prompt. A change to what a prompt asks for still needs one real run.

### Run telemetry

Every workflow run leaves `.verify/<slug>/run.json` (gitignored): one entry per agent call with its label, phase, agent, the model asked for, the attempt (2 is a retry), the outcome (`ok`, `empty`, `threw`) and the verdict. `eval-plan-feature` writes `.verify/eval-plan-feature/run.json`.

It has two halves, because a workflow script gets nothing from `agent()` but the answer: no tokens, no clock, no file access.

1. **In the run.** The workflow library ([`lib.js`](../../.claude/workflow-src/lib.js)) counts every call. At each stop and at the end, just before the memory record, the `runner` writes the ledger with `bun scripts/run-telemetry.ts record <slug> <workflow>`. The command carries a count and a checksum, so a garbled copy writes nothing. A failed write is logged and never stops a run. This half knows no tokens and no seconds. `record` keeps the stored numbers only when the new ledger strictly extends the stored one (a resumed run replays from cache, so its next write is longer); an equal, shorter or different ledger is a new run and starts with no numbers.
2. **After the run.** Claude Code keeps each agent's transcript in the run's transcript directory (`<session dir>/subagents/workflows/<run id>/`, the directory the Workflow tool names when it returns). `bun scripts/run-telemetry.ts ingest <slug> <workflow> <that directory>` reads it and fills in tokens in and out, cache tokens, seconds and the model that ran. Run it after each return of a workflow, once per run id; a feature that stopped and resumed has several. `ingest` pairs each journal entry with a call by the agent's id, which it stores on the call, so running it twice changes nothing and a missing transcript leaves only that call empty. An entry the ledger has no call for (the last `runner` write and the memory record come after the final ledger) is added as a call. That directory's layout is not a documented API: when a file is missing or reads differently, the fields stay empty and every table prints `n/a`. Nothing is estimated.

| Command | What it does |
|---|---|
| `bun scripts/run-telemetry.ts record <slug> <workflow>` | Writes the ledger from stdin. The workflows call it; you do not. |
| `bun scripts/run-telemetry.ts ingest <slug> <workflow> <dir>...` | Adds tokens, seconds and the model from the transcripts. With no ledger yet, it builds the calls from the journal. |
| `bun scripts/run-telemetry.ts summary <slug> [--markdown]` | One table per workflow: calls, retries, failed, tokens in and out, seconds, by phase. Review pages show it; `ship-feature` and `brand-init` put the `--markdown` form in the PR body under `## Run`. |
| `bun scripts/run-telemetry.ts stats [--dir .verify]` | Across every feature on this machine: cost per feature (in tokens; the repo holds no price table), the slowest phase, the failure rate by agent. |

A PR body shows the ledger as it stood at the last stop before the PR opened, so the steps after it (the push, the roll-up review) are not in that table; `summary` run later shows them.

## Review loop and merge bar

`ship-feature` reviews stacked PRs on this machine and spends Greptile on one PR per feature: the roll-up, or the single PR when there is one. Per feature that is 1-3 Greptile reviews. Before this, every stacked PR was reviewed by the Greptile CLI before push, then by Greptile on GitHub, and re-scored after every rebase: on Sola in November 2026, six features of 8-11 stacked PRs each cost 30+ Greptile reviews per feature, mostly of code already reviewed, and days of approvals.

1. **Whole tree** (Review phase): gates, `effect-ts-enforcer`, `security-reviewer`, `scale-reviewer`, `maintainability-reviewer`, browser walk, design critique. Each P0/P1 goes back to the lane that owns the file.
2. **Each stacked branch** (Local review, before any push): the `code-review` skill at `high` on `git diff <branch below>...<branch>`, without `--comment` or `--fix`. `review-responder` fixes or declines each P0/P1 inside the branch's fence; the branches above restack and re-run `./scripts/verify.sh --changed <branch below>`. One round (`args.reviewRounds`, default 1): the second look is Greptile on the roll-up. P2/P3 findings are kept in the result as advisory.
3. **The roll-up** (Roll-up Greptile): one `@greptileai review`. `scripts/pr-review-wait.ts` counts a review only when it names the PR's current head (a clean review is Greptile's completed check plus a summary whose "Last reviewed commit" is the head); a timeout is a stop, not a pass. The stacked PRs are already merged into `review/<slug>`, so each fix is a new commit there, made inside the fence of the stacked PR that owns the file. Each round's GitHub writes (pushes, thread replies, the next trigger) run in one step, so you approve them once a round. Three rounds, to 5/5 or every remaining comment declined with a reason.

After the first push no branch is rewritten: `.claude/settings.json` denies `git push --force`, which also blocks `--force-with-lease`, so every push is a fast-forward. Roll-up fixes are new commits on `review/<slug>`.

**Lean on stacked PRs, full on the roll-up.** A stacked PR gates nothing: it merges into `review/<slug>` or a wave branch, never into the default branch. So each stacked branch gets the lean mode, `./scripts/verify.sh --changed <branch below>` (typecheck, the house linter on the changed files, the unit tests related to them, the e2e specs the test map ties to them; every gate when a gate script, config, workflow or the lockfile changed), and CI gives it one lean job. The full `./scripts/verify.sh`, any second review round and the Greptile loop run once, on the roll-up's head, which CI checks with the full suite and a preview. Which CI checks run for which base: [Which checks run where](../ci/pipelines.md#which-checks-run-where).

**Merge bar**

1. `./scripts/verify.sh` green on the top branch (the e2e gate restores the seeded DB itself); `./scripts/verify.sh --changed <branch below>` green on every branch alone.
2. Local reviews (code-review, security, scale, maintainability, `effect-ts-enforcer`): no open P0/P1.
3. Greptile 5/5 on the roll-up's current head, or each remaining comment declined with a reason. The 5/5 bar applies to the roll-up head only, never to the stacked PRs.
4. You (or a coordinator you authorized) squash-merge the roll-up with `gh pr merge <n> --squash --match-head-commit <reviewed sha>`. `ship-feature` prints the command with the sha Greptile reviewed. The stacked PRs already show Merged (into `review/<slug>`), so nothing is left to close.

Commit subjects and PR titles follow Conventional Commits, checked by the `commit-msg` hook and the PR title job; the rule and the titles of the roll-up and release PRs are in [Commit subjects and PR titles](../ci/pipelines.md#commit-subjects-and-pr-titles).

**Greptile settings.** [`greptile.json`](../../greptile.json) sets `includeBranches` to `staging` and `production`, so Greptile reviews only PRs into those two; Greptile reads it from the PR's own branch, so every branch cut after it lands carries it. Also set Greptile, in its dashboard and by hand, to review only when mentioned: the workflow posts `@greptileai review` on the roll-up itself, so an automatic review when the roll-up opens would be a second, wasted one.

**When another feature merges first.** The stack is already in `review/<slug>`, so merge the default branch into it (`bun scripts/default-branch.ts` prints it; `staging` today); no rebase, no force push, and no re-review of the stacked PRs:

- `git switch review/<slug>`, then `git merge "origin/$(bun scripts/default-branch.ts)"`. Migrations and ADRs: renumber yours to follow its latest. `scripts/seed-preview.ts` and `GLOSSARY.md`: keep both sides.
- Re-run typecheck, unit tests and e2e. Every Playwright run restores the seeded DB in its global setup.
- `git push origin review/<slug>` (a fast-forward), then post `@greptileai review` on the roll-up. The squash merge folds the merge commit away.

**Fresh worktrees.** A `node_modules/node_modules` symlink to the main checkout breaks tests ("Invalid hook call", Playwright "No tests found"). `ship-feature`'s preflight moves it aside in a linked worktree; elsewhere, `mv node_modules/node_modules node_modules/.nested-modules-aside`.

## Slash commands

| Command | Purpose |
|---------|---------|
| [`/harness-check`](../../.claude/commands/harness-check.md) | [`scripts/harness-check.sh`](../../scripts/harness-check.sh) — CLAUDE↔AGENTS symlink, sub-agent frontmatter, Kimi roster symlink, hook wiring + hook tests, `harness.config.json` (check M), workflow scripts (they parse, and match their sources), the generated lint rules page, and the live repo rules against `.github/repo-rules.json` ([`docs/ci/repo-rules.md`](../ci/repo-rules.md); a notice when GitHub cannot be read). No LLM, exits non-zero on drift. |

## Gates

Listed in `gates` in [`harness.config.json`](../../harness.config.json) and run by [`scripts/verify.sh`](../../scripts/verify.sh), the one runner for CI, `init.sh` and agents:

| Gate | Command | Runs in |
|------|---------|---------|
| typecheck | `bun run typecheck` | lean, baseline, full |
| lint | `bun run lint` (Biome, the house linter, dead code; [`lint.md`](lint.md)) | lean, baseline, full |
| test | `bun run test` | lean, baseline, full |
| non-negotiables-selftest | `bun run scripts/check-non-negotiables.ts --selftest` | lean, baseline, full |
| non-negotiables | `bun run scripts/check-non-negotiables.ts` | lean, baseline, full |
| migrations | `bun run scripts/migration-check.ts` | baseline, full |
| harness | `./scripts/harness-check.sh` | baseline, full |
| secrets | `bun run scripts/secret-scan.ts` | baseline, full |
| audit | `bun run scripts/package-audit.ts` | baseline, full |
| build | `bun run build` | full |
| e2e | `bun run test:e2e` | full |

`./scripts/verify.sh` runs the full set, `--baseline` the quick set, `--lean` the lean tier (CI's job on a stacked PR), `--only <gate>` one gate, `--list` prints them. To add a gate, add an object to `gates` in `harness.config.json`, with the `tier` it first runs in (see [`harness-config.md`](harness-config.md)) — CI picks it up.

`./scripts/verify.sh --changed [base]` is for a stacked change. It diffs the working tree (committed, staged, unstaged and untracked) against the merge base with `base` (default: the pull request's target, else the default branch) and runs: typecheck; `bun run lint <changed .ts/.tsx>` (Biome and the house linter on those files); `bunx vitest related --run <changed .ts/.tsx>` (the tests that import them, at any depth); and `CI=1 bun run test:e2e <specs>` for the specs the [test map](lint-rules.md#the-test-map) ties to them (a changed spec, a `covered-by` spec, a machine's paths spec, the specs that visit a changed route, the specs that import a changed file). It prints the base, what it ran, and each gate it skipped with the reason. A change to a gate script, `harness.config.json`, `scripts/lint/**`, the lint runner, a config file (`biome.jsonc` and `knip.json` included), `.github/`, `.claude/`, a migration, the schema or the lockfile runs every gate instead and says which file caused it. The plan is `scripts/verify-changed.ts`; its rules are `scripts/lib/verify-plan.ts`.

The `e2e` gate needs the network: the sign-in and sign-up pages load Turnstile from `challenges.cloudflare.com`. Each spec file sends its own client IP (`e2e/lib/client-ip.ts`), so the auth rate limits count per file ([`docs/auth.md`](../auth.md#rate-limits)).

The `lint` gate is the one entry point: Biome, the house linter, import cycles and dead code, one finding shape ([`lint.md`](lint.md)). The two `non-negotiables` gates run the house linter (`bun run lint:house`) and its self-test on their own: one file per rule in `scripts/lint/rules/`, findings that say the fix, and a baseline that only shrinks. The rules, the baseline and how to add a rule: [`lint-rules.md`](lint-rules.md).

## Commands (README.md has the same list)

```bash
gh issue list --label ready-for-agent  # Work an agent can pick up (the label is tracker.readyLabel; bun scripts/tracker.ts ready lists them)
./scripts/verify.sh       # Run every gate (--baseline for the quick set, --changed [base] for a stacked change, --list to see them)
./scripts/harness-check.sh # Harness invariants (symlinks, sub-agent frontmatter, hooks, workflows)
./init.sh                 # Harness bootstrap — install + skills + migrate + typecheck + test (run start of session)
./init.sh --baseline      # Baseline only (typecheck + test + harness-check)
bun run dev               # Dev server (auto-runs local DB migrations) → http://localhost:5173
bun run build             # Production build
bun run deploy            # Build + deploy to Cloudflare Workers
bun run deploy:preview    # Build with CLOUDFLARE_ENV=preview + deploy the -preview worker
bun run typecheck         # Full typecheck (cf-typegen + react-router typegen + tsc): app, workers, scripts, e2e, configs
bun run lint              # Biome + house linter + dead code, one finding per line (lint.md)
bun run lint <files>      # The same for some files (no dead-code or import-cycle pass); --fix applies safe fixes
bun run lint:staged       # The same for staged files
bun run lint:effect       # Effect language service diagnostics (about 20 s; CI runs them on PRs into the default branch or production)
bun run format            # Format every file Biome covers
bun run test              # Vitest unit tests (one-shot)
bun run test:watch        # Vitest watch mode
bun run lint:house [files] # House lint rules: the named files, or the whole repo (--rules lists them)
bun run test:e2e          # Playwright e2e tests
bun run test:e2e:videos --out <dir>  # Record the @golden/@error specs as PR videos
bun run db:generate       # Generate Drizzle migration
bun run db:migrate:local  # Apply migrations to local D1
bun run db:migrate:remote # Apply migrations to remote D1
bun run db:migrate:preview # Apply migrations to the preview-env D1
bun run db:seed           # Restore the seed fixtures in local D1 (--scenario base|empty|many-users); `bun run dev` and every Playwright run do this
bun run db:prepare        # Migrate and seed local D1 (what `bun run dev` runs first)
bun run db:reset          # Wipe local D1 and R2, then migrate and seed (--scenario); refuses while the dev server runs
bun run db:seed:preview   # Seed the preview-env D1 with the same fixtures
bun run db:studio         # Drizzle Studio
```

## One file, two names

`CLAUDE.md` is a symlink → `AGENTS.md`. Edit `AGENTS.md` only. No mirroring needed — both names resolve to the same file. If you ever see `CLAUDE.md` as a real (non-symlink) file, re-create the symlink: `ln -sf AGENTS.md CLAUDE.md`.

Same trick for the sub-agents: `.kimi-code/agents` is a symlink → [`.claude/agents`](../../.claude/agents), so [Kimi Code](https://moonshotai.github.io/kimi-code/) (`kimi`) runs the same harness operators Claude Code does — add an agent once, both CLIs see it. Edit `.claude/agents/` only. Caveats (`model:` vs `model_preference`, Claude-only tool names) are in [`.claude/agents/README.md`](../../.claude/agents/README.md); `./scripts/harness-check.sh` fails if the symlink is gone. Re-create: `mkdir -p .kimi-code && ln -sfn ../.claude/agents .kimi-code/agents`.
