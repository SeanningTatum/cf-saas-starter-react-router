# Sub-agents

Project sub-agents for repo-specific work. Planning uses Matt Pocock's skills (`/grill-me` or `/grill-with-docs`, `/to-spec`, `/to-tickets`); the order of the waves is in AGENTS.md ("Delegate in parallel") and the [`ship-feature`](../workflows/ship-feature.js) workflow.

## Roster

| Agent | Use when |
|-------|----------|
| [`ui-builder`](ui-builder.md) | Any user-visible work, inside a file fence the caller sets (runs on `opus`) |
| [`test-author`](test-author.md) | After a feature or fix: write or update the unit tests (runs on `opus`) |
| [`span-instrumenter`](span-instrumenter.md) | After adding an endpoint, repo method or service call: add or audit tracing spans |
| [`effect-ts-enforcer`](effect-ts-enforcer.md) | Before `./scripts/verify.sh`: read-only review against the five non-negotiables |
| [`context-memory`](context-memory.md) | Start of any task (recall, read-only) and its end (record, one writer): per-feature context, decisions, links, todos, where work stopped — stored outside the repo |
| [`feature-verifier`](feature-verifier.md) | Any user-visible flow: browser walk, screenshots, verdict in `.verify/<slug>/verdict.md` |
| [`runner`](runner.md) | A workflow step that needs a shell but no judgment: a git snapshot, a gate run, a commit (runs on `haiku`) |
| [`context-scout`](context-scout.md) | Planning: recall the memory, issues, PRs and code that already cover a ticket's area, sourced (runs on `sonnet`) |
| [`ticket-auditor`](ticket-auditor.md) | Planning: grade a ticket on the 13-item readiness checklist and draft the amended ticket |
| [`product-strategist`](product-strategist.md) | Planning: user, job, fit, metric and non-goals for a feature |
| [`ux-planner`](ux-planner.md) | Planning: flow and empty/loading/error/success states; `has_ui: false` for backend-only work |
| [`architect`](architect.md) | Planning: tables, procedures, tagged errors, contract and disjoint lane fences |
| [`stack-planner`](stack-planner.md) | Planning: cut the fences into an ordered PR stack with a flow diagram |
| [`ui-prototyper`](ui-prototyper.md) | Planning: write one self-contained HTML prototype of a UI direction, or add its state switcher (runs on `opus`) |
| [`proto-critic`](proto-critic.md) | Planning: critique one prototype from screenshots (light/dark, desktop/mobile) and the design audit; never edits it (runs on `opus`) |
| [`plan-judge`](plan-judge.md) | Planning: grade one producer's output against its `## Checklist` (runs on `sonnet`, read-only) |
| [`backend-builder`](backend-builder.md) | Build lane: schema, migration, repository + test, tRPC procedure, tagged errors, seed fixtures, inside a fence; returns when typecheck passes (runs on `opus`) |
| [`security-reviewer`](security-reviewer.md) | Review: auth level, IDOR, input validation, PII in telemetry, XSS, uploads, anonymous reach; read-only, every P0/P1 has file:line and an attack |
| [`scale-reviewer`](scale-reviewer.md) | Review: N+1, missing indexes, unbounded lists, Workers and D1 limits, memory; read-only, each finding tied to a data size |
| [`maintainability-reviewer`](maintainability-reviewer.md) | Review: duplication of existing helpers, code and files the acceptance does not need, over-long units, restating docs and tests; read-only, each finding names the reuse or deletion |
| [`analytics-instrumenter`](analytics-instrumenter.md) | After the build: the fewest analytics events that compute the feature's metric, through the `Analytics` wrapper |
| [`e2e-author`](e2e-author.md) | After the build: committed Playwright specs in `e2e/`, one golden and one error path per flow (runs on `opus`) |
| [`docs-writer`](docs-writer.md) | After review: decision record, glossary, ADR if hard to reverse, changed docs, one PR body per PR in `.verify/<slug>/` |
| [`review-responder`](review-responder.md) | After a PR opens: triage a review bot's comments, fix inside the PR's fence, reply on each thread, one commit; never pushes (runs on `opus`) |

The planning agents are driven by [`.claude/workflows/plan-feature.js`](../workflows/plan-feature.js); call them by hand only to debug a step. Each producer ends with a `## Checklist` of `- **id**: condition` lines that `plan-judge` reads, so keep that section last.

Plugin agents (enabled in `.claude/settings.json`; names carry the plugin prefix):

| Agent | Use when |
|-------|----------|
| `feature-dev:code-architect` | Design a feature blueprint before coding |
| `feature-dev:code-explorer` | Trace how an existing feature runs |
| `feature-dev:code-reviewer` | Generic review for bugs and security |
| `code-simplifier:code-simplifier` | Simplify recently changed code |
| `impeccable:impeccable-documenter` | Write DESIGN.md from a finished build (`brand-init` Close; its preflight fails without the plugin) |

Use a project agent for the non-negotiables, this repo's UI rules and its verification standard. Use a plugin agent for generic engineering.

## Editing

- Frontmatter: `name`, `description`, `tools`, `model`. `scripts/harness-check.sh` fails an agent missing `---`, `name:` or `description:`. Workflows call agents by `name`; do not rename one.
- `description` is what routers read: one short paragraph, two or three examples.
- Grant the fewest tools. `effect-ts-enforcer` has no `Edit` or `Write`.
- Default `model: sonnet`. `test-author` and `ui-builder` use `opus`: choosing which tests to write, and building UI to a brand, take judgment a cheaper model lacks.
- Add an agent only for a recurring task with long instructions and structured output. Otherwise work in the main thread.

## Token cost

Measured on the brand-init trial run (2026-10-24, 87.5M tokens through models): the cost of an agent is its turns times its context, because every turn re-reads the whole context.

- A workflow `agent()` call with no `agentType` starts at about 40k tokens (every tool, the full skill list, AGENTS.md). An agent with a short `tools:` list starts at 10–30k. Give every workflow step an `agentType`; use `runner` for shell-only steps.
- Writer lanes run long. A 20-file lane went 72 turns and 10.5M tokens; most of that came after typecheck passed, on browser checks the check phase repeats. Keep a lane to about 10 files and keep the browser out of it.
- Every loaded skill stays in context for every later turn. Load only the ones the task needs, once each.

## Kimi Code

`.kimi-code/agents` is a symlink to this directory, so `kimi` sees the same agents. `harness-check.sh` fails if the symlink is missing or replaced by a copy. Not shared: slash commands, hooks, skills.

What does not carry over:

- `model:`. Kimi reads `model_preference`, so `model: opus` is ignored.
- Claude-only tool names in `tools:` (`Task`, `Skill`, MCP tools). `Read`, `Write`, `Edit`, `Glob`, `Grep` and `Bash` match, so read-only agents stay read-only.
- This README has no frontmatter, so Kimi logs one `Skipping invalid agent file` warning per session. Ignore it.
