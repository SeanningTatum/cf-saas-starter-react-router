# Sub-agents — harness operators

Project-local Claude Code subagents that wrap pieces of [`.brain/HARNESS.md`](../../.brain/HARNESS.md). The main thread delegates to these so it doesn't have to re-load harness rules every turn.

## Roster

| Agent | Subsystem | Use when |
|-------|-----------|----------|
| [`brain-navigator`](brain-navigator.md) | Instructions | Before writing code — get reading list for the task |
| [`recipe-runner`](recipe-runner.md) | Instructions + Lifecycle | Adding new code that matches one of the 8 recipes |
| [`effect-ts-enforcer`](effect-ts-enforcer.md) | Verification | After writing code, before `/verify-done` — review against 5 non-negotiables |
| [`verify-done-runner`](verify-done-runner.md) | Verification | Before declaring any non-trivial task done |
| [`feature-tracker`](feature-tracker.md) | State + Scope | Status changes (start / ship / block / scope a feature) |

## Typical flow

```
1. brain-navigator     →  "what do I read?"
2. recipe-runner       →  applies the recipe (or main thread codes from rule file)
3. effect-ts-enforcer  →  reviews the diff
4. verify-done-runner  →  runs the full checklist
5. feature-tracker     →  flips status + appends to progress.md
```

## Plugin-provided agents (complementary, not replaced)

These come from shared plugins enabled in `.claude/settings.json`. They cover *generic* concerns; the harness-local agents above cover *project-specific* concerns.

| Agent | Plugin | Use when |
|-------|--------|----------|
| `feature-dev:code-architect` | feature-dev | Designing a feature blueprint before coding |
| `feature-dev:code-explorer` | feature-dev | Deep tracing of an existing feature's runtime |
| `feature-dev:code-reviewer` | feature-dev | Generic code review (bugs, security, quality) |
| `code-simplifier:code-simplifier` | code-simplifier | Simplifying recently-modified code |
| `claude-md-management:claude-md-improver` | claude-md-management | Auditing CLAUDE.md / AGENTS.md |
| `caveman:cavecrew-*` | caveman | Token-compressed locator / builder / reviewer |

**Rule of thumb**: project-local agent if the task involves the brain, the 5 non-negotiables, the recipes, or `feature_list.json`. Plugin agent for generic engineering work.

## Editing these files

- Sub-agents are markdown files with YAML frontmatter (`name`, `description`, `tools`, `model`).
- Description should match the schema's expected pattern (single short paragraph) — Claude Code uses it to decide when to spawn the agent.
- Tools: minimal set. Read-only agents (`brain-navigator`, `effect-ts-enforcer`, `verify-done-runner`) explicitly omit `Edit` / `Write`.
- Model: `sonnet` is the default for harness operators (cost / quality balance).

## When to add a new sub-agent

Only when:
- The task recurs frequently
- The instructions are long enough that the main thread benefits from offloading
- The output is structured enough to consume back as tool result

Otherwise: do it in the main thread. More agents ≠ better harness.
