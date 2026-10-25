# Sub-agents

Project sub-agents for repo-specific work. Planning uses Matt Pocock's skills (`/grill-me` or `/grill-with-docs`, `/to-spec`, `/to-tickets`); the order of the waves is in AGENTS.md ("Delegate in parallel") and [`/build-feature`](../commands/build-feature.md).

## Roster

| Agent | Use when |
|-------|----------|
| [`ui-builder`](ui-builder.md) | Any user-visible work, inside a file fence the caller sets (runs on `opus`) |
| [`test-author`](test-author.md) | After a feature or fix: write or update the unit tests (runs on `opus`) |
| [`span-instrumenter`](span-instrumenter.md) | After adding an endpoint, repo method or service call: add or audit tracing spans |
| [`effect-ts-enforcer`](effect-ts-enforcer.md) | Before `./scripts/verify.sh`: read-only review against the five non-negotiables |
| [`context-memory`](context-memory.md) | Start of any task (recall, read-only) and its end (record, one writer): per-feature context, decisions, links, todos, where work stopped — stored outside the repo |
| [`feature-verifier`](feature-verifier.md) | Any user-visible flow: browser walk, screenshots, verdict in `.verify/<slug>/verdict.md` |

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
