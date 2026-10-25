# Sub-agents

Project sub-agents for repo-specific work. The method (start, plan, execute, verify, done) comes from the brain-axi skills; the order of the waves is in AGENTS.md ("Delegate in parallel") and [`/build-feature`](../commands/build-feature.md).

## Roster

| Agent | Use when |
|-------|----------|
| [`ui-builder`](ui-builder.md) | Any user-visible work, inside a file fence the caller sets (runs on `opus`) |
| [`test-author`](test-author.md) | After a feature or fix: write or update the unit tests (runs on `opus`) |
| [`span-instrumenter`](span-instrumenter.md) | After adding an endpoint, repo method or service call: add or audit tracing spans |
| [`effect-ts-enforcer`](effect-ts-enforcer.md) | Before `brain verify`: read-only review against the five non-negotiables |
| [`feature-verifier`](feature-verifier.md) | Any user-visible flow: browser walk, screenshots, verdict via `brain verifications add` |
| [`context-scout`](context-scout.md) | Planning: collect what the brain, code and GitHub already hold on a ticket's area, sourced (runs on `sonnet`) |
| [`ticket-auditor`](ticket-auditor.md) | Planning: grade a ticket on the 13-item readiness checklist and draft the amended ticket |
| [`product-strategist`](product-strategist.md) | Planning: user, job, fit, metric and non-goals for a feature |
| [`ux-planner`](ux-planner.md) | Planning: flow and empty/loading/error/success states; `has_ui: false` for backend-only work |
| [`architect`](architect.md) | Planning: tables, procedures, tagged errors, contract and disjoint lane fences |
| [`stack-planner`](stack-planner.md) | Planning: cut the fences into an ordered PR stack with a flow diagram |
| [`ui-prototyper`](ui-prototyper.md) | Planning: write one self-contained HTML prototype of a UI direction, or add its state switcher (runs on `opus`) |
| [`proto-critic`](proto-critic.md) | Planning: critique one prototype from screenshots (light/dark, desktop/mobile) and the design audit; never edits it (runs on `opus`) |
| [`plan-judge`](plan-judge.md) | Planning: grade one producer's output against its `## Checklist` (runs on `sonnet`, read-only) |

The last seven are driven by [`.claude/workflows/plan-feature.js`](../workflows/plan-feature.js); call them by hand only to debug a step. Each producer ends with a `## Checklist` of `- **id**: condition` lines that `plan-judge` reads, so keep that section last.

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

## Kimi Code

`.kimi-code/agents` is a symlink to this directory, so `kimi` sees the same agents. `harness-check.sh` fails if the symlink is missing or replaced by a copy. Not shared: slash commands, hooks, skills.

What does not carry over:

- `model:`. Kimi reads `model_preference`, so `model: opus` is ignored.
- Claude-only tool names in `tools:` (`Task`, `Skill`, MCP tools). `Read`, `Write`, `Edit`, `Glob`, `Grep` and `Bash` match, so read-only agents stay read-only.
- This README has no frontmatter, so Kimi logs one `Skipping invalid agent file` warning per session. Ignore it.
