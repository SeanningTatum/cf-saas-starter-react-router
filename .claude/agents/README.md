# Sub-agents

Project sub-agents for repo-specific work. Planning uses Matt Pocock's skills (`/grill-me` or `/grill-with-docs`, `/to-spec`, `/to-tickets`); the order of the waves is in AGENTS.md ("Delegate in parallel") and the [`ship-feature`](../workflows/ship-feature.js) workflow.

## Roster

<!-- roster:start -->
_Generated from each agent's frontmatter by `bun scripts/roster.ts write`. Do not edit between the markers._

| Agent | Model | Effort | What it does |
|-------|-------|--------|--------------|
| [`architect`](architect.md) | opus | high | Fixes the backend shape and the contract each build lane works against - tables, repositories, procedures, tagged errors, spans, seed fixtures, and disjoint file fences |
| [`backend-builder`](backend-builder.md) | sonnet | medium | Builds the server side of a feature inside a file fence the caller sets - Drizzle schema and migration, repository with its unit test, tRPC procedure, tagged errors, Effect Schema inputs, seed fixtures |
| [`context-memory`](context-memory.md) | haiku | low | Reads and records the per-feature working memory through scripts/memory.ts - turns what a caller says into the script's fields, answers from the brief, and shortens a file that has grown too long |
| [`context-scout`](context-scout.md) | sonnet | medium | Collects what the repo already knows about a feature's area, with a source on every line |
| [`docs-writer`](docs-writer.md) | sonnet | medium | After a feature is built, commits its decision record, adds domain terms, writes an ADR only for a hard-to-reverse decision, updates docs whose behavior changed, and drafts one PR body per PR in the stack |
| [`e2e-author`](e2e-author.md) | sonnet | medium | Writes committed Playwright specs under e2e/ for a feature - one golden path and one error path per flow, logged in with the seeded fixtures, each naming the regression it catches |
| [`effect-ts-enforcer`](effect-ts-enforcer.md) | sonnet | medium | Reviews a diff or file set against the five non-negotiables in AGENTS.md |
| [`feature-verifier`](feature-verifier.md) | sonnet | medium | Walks a feature's golden path plus one error path through the live app with a throwaway Playwright CLI script, screenshots each step, and writes the verdict to `.verify/<slug>/verdict.md` |
| [`instrumenter`](instrumenter.md) | sonnet | medium | Adds the feature's telemetry in one pass - Effect tracing spans on tRPC procedures, repositories and services per the span-naming convention, and, when the caller gives a success metric and the Analytics wrapper exists, the fewest product-analytics events that compute that metric |
| [`maintainability-reviewer`](maintainability-reviewer.md) | sonnet | medium | Read-only review of a diff for DRY, maintainability and need - duplication of an existing helper, schema, prompt or component, code, files, options and exports the feature's acceptance does not require, speculative generality, single-use wrappers, dead code, over-long functions, restating comments and docs, near-duplicate tests |
| [`plan-judge`](plan-judge.md) | sonnet | medium | Grades one plan-feature step's output against that producer agent's checklist, item by item, with a verbatim quote as evidence |
| [`proto-critic`](proto-critic.md) | opus | high | Critiques one UI prototype from screenshots at desktop and mobile, light and dark, plus the design audit, and returns ranked findings |
| [`review-responder`](review-responder.md) | opus | high | Handles review comments on one PR or one stacked branch, on the branch already checked out - the code-review skill's before push, or Greptile's on a roll-up PR, fixed on the roll-up branch inside the fence of the stacked PR that owns the file |
| [`runner`](runner.md) | haiku | low | Runs a short, mechanical list of shell steps and reports the output - git status snapshots, gate runs, tracker writes, commits |
| [`scale-reviewer`](scale-reviewer.md) | sonnet | medium | Read-only review of a diff for Cloudflare Workers and D1 scale - N+1 queries, missing indexes, unbounded lists, batching, rate limiting, queuing and backpressure, races and idempotency, CPU-time and subrequest limits, buffering whole R2 objects, cache chances, client bundle weight |
| [`security-reviewer`](security-reviewer.md) | opus | high | Read-only security review of a diff for this stack - tRPC auth levels, object-level authorization, input validation, Better Auth sessions, secrets and PII in telemetry, XSS, open redirects, R2 uploads, anonymous reach of public mutations, SQL built from strings |
| [`test-author`](test-author.md) | opus | high | Writes and maintains the repo's unit tests |
| [`ticket-auditor`](ticket-auditor.md) | opus | high | Grades a ticket against the 13-item readiness checklist, tags each answer with its source, and drafts the amended ticket plus the questions a human must answer |
| [`ui-builder`](ui-builder.md) | opus | high | Builds and changes user-visible UI in this repo - routes, components, forms, tables, empty/loading/error states, brand work |
| [`ui-prototyper`](ui-prototyper.md) | opus | high | Writes one self-contained HTML prototype of a UI direction under plans/, using the app's own tokens, so a human can look at it before any app code exists |
| [`ux-planner`](ux-planner.md) | opus | high | Plans a feature's user flow, every screen and each screen's empty, loading, error and success states |

21 agents: 9 opus, 10 sonnet, 2 haiku
<!-- roster:end -->

The planning agents are driven by [`.claude/workflows/plan-feature.js`](../workflows/plan-feature.js); call them by hand only to debug a step. Each producer ends with checklist sections of `- **id**: condition` lines that `plan-judge` reads by heading, so keep them last. Most carry one `## Checklist`. `ticket-auditor` and `architect` run in a second mode and carry a second checklist for it: `## Fit checklist` (the auditor, `Mode: fit.`) and `## Stack checklist` (the architect, `Mode: stack.`).

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

- Frontmatter: `name`, `description`, `tools`, `model`, `effort`. `scripts/harness-check.sh` fails an agent missing any of them, a `name` that differs from the file name, a `model` that is not `opus`, `sonnet` or `haiku`, or an `effort` that is not `low`, `medium` or `high`. Workflows call agents by `name`; do not rename one.
- `description` is what routers read: one short paragraph, two or three examples. Its first sentence (up to the first ". " or " Examples - ") is the "What it does" cell in the roster, so make that sentence stand alone.
- Grant the fewest tools. `effect-ts-enforcer` has no `Edit` or `Write`.
- Choose `model` and `effort` by this rule:
  1. `opus`, effort `high`: judgment. The agent decides something later steps build on (a contract, a verdict, which tests matter), or its output is a matter of taste (design, critique), or a miss is found late and costs a lot (security).
  2. `sonnet`, effort `medium`: work to a contract or a checklist, where a gate, a schema, a judge or a reviewer catches a wrong answer in the same run.
  3. `haiku`, effort `low`: steps with no judgment. If a script can do it, write the script.
- The roster table is generated from the frontmatter. After you add, remove or edit an agent, run `bun scripts/roster.ts write`; `./scripts/harness-check.sh` fails when the table is stale or a field is invalid.
- Add an agent only for a recurring task with long instructions and structured output. Otherwise work in the main thread.

## Token cost

Measured on the brand-init trial run (2026-10-24, 87.5M tokens through models): the cost of an agent is its turns times its context, because every turn re-reads the whole context.

- A workflow `agent()` call with no `agentType` starts at about 40k tokens (every tool, the full skill list, AGENTS.md). An agent with a short `tools:` list starts at 10–30k. Every workflow step names an `agentType`, so pick the narrowest agent that fits; `runner` for shell-only steps. Use `general-purpose` only when no project agent has the job, with a comment saying why.
- Writer lanes run long. A 20-file lane went 72 turns and 10.5M tokens; most of that came after typecheck passed, on browser checks the check phase repeats. Keep a lane to about 10 files and keep the browser out of it.
- Every loaded skill stays in context for every later turn. Load only the ones the task needs, once each.

## Kimi Code

`.kimi-code/agents` is a symlink to this directory, so `kimi` sees the same agents. `harness-check.sh` fails if the symlink is missing or replaced by a copy. Not shared: slash commands, hooks, skills.

What does not carry over:

- `model:` and `effort:`. Kimi reads `model_preference`, so `model: opus` is ignored.
- Claude-only tool names in `tools:` (`Task`, `Skill`, MCP tools). `Read`, `Write`, `Edit`, `Glob`, `Bash` and `Grep` match, so read-only agents stay read-only.
- This README has no frontmatter, so Kimi logs one `Skipping invalid agent file` warning per session. Ignore it.
