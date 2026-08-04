# Sub-agents — harness operators

Project-local Claude Code subagents that wrap pieces of [`.brain/HARNESS.md`](../../.brain/HARNESS.md). The main thread delegates to these so it doesn't have to re-load harness rules every turn.

## Roster

| Agent | Subsystem | Use when |
|-------|-----------|----------|
| [`brain-navigator`](brain-navigator.md) | Instructions | Before writing code — get reading list for the task |
| [`ui-builder`](ui-builder.md) | Instructions + Verification (builds) | **Any user-visible work** — routes, components, marketing surfaces, forms, states. Carries the frontend rules, craft moves and anti-slop tells so the mistakes are not made, and self-measures with `design:audit` |
| [`design-critic`](design-critic.md) | Verification (judges) | After UI work — judges the *render* against the tells + craft, from screenshots only. P0/P1 block. Backstop, not the method |
| [`recipe-runner`](recipe-runner.md) | Instructions + Lifecycle | Adding new code that matches one of the add-* recipes |
| [`test-author`](test-author.md) | Verification (authors) | After implementing a feature/fix — write or update the unit tests that pin its business logic |
| [`span-instrumenter`](span-instrumenter.md) | Verification (observability) | After adding an endpoint / repo method / service call — add or audit tracing spans per convention |
| [`effect-ts-enforcer`](effect-ts-enforcer.md) | Verification | After writing code, before `/verify-done` — review against 5 non-negotiables |
| [`verify-done-runner`](verify-done-runner.md) | Verification | Before declaring any non-trivial task done |
| [`feature-tracker`](feature-tracker.md) | State + Scope | Status changes (start / ship / block / scope a feature) |

## Typical flow

```
1. brain-navigator     →  "what do I read?"
2. recipe-runner       →  applies the recipe (or main thread codes from rule file)
3. test-author         →  writes the tests that pin the new logic
4. span-instrumenter   →  adds/audits tracing spans on the new code paths
5. effect-ts-enforcer  →  reviews the diff
6. verify-done-runner  →  runs the full checklist
7. feature-tracker     →  flips status + appends to progress.md
```

### UI work has its own loop

```
0. /design-research    →  tier 2 only: references → three directions → reference lock
1. ui-builder          →  builds it with the rules already loaded, then measures itself
                          (bun run design:audit — HARD failures fixed before returning)
2. design-critic       →  judges the render from screenshots; P0/P1 block
3. feature-verifier    →  proves the flow works in the live app
4. test-author         →  pins the design's intent (live figure source, status in words,
                          scoped tokens do not leak)
```

### Or fan them out — `/build-feature`

For a feature spanning more than one layer, [`/build-feature`](../commands/build-feature.md) runs the
same operators concurrently via [`.claude/workflows/build-feature.js`](../workflows/build-feature.js):

```
Orient    brain-navigator ‖ nearest-feature trace ‖ UI tier check      (3 in parallel, read-only)
Contract  architect fixes the interface → one writer lands it          (the only sequential step)
Build     data ‖ api ‖ ui ‖ e2e — each fenced to disjoint paths        (up to 5 in parallel)
Verify    verify-done-runner ‖ effect-ts-enforcer ‖ span-instrumenter
          ‖ feature-verifier ‖ design-critic                           (5 in parallel)
Close     synthesis: what is true, what blocks, what a human must decide
```

The insight is that most of a feature's apparent ordering is a **compile** dependency, not an
**information** dependency: once the interface is fixed, the server lane and the UI lane need nothing
from each other. The cost is that parallel writers must own **disjoint paths** — that constraint is
enforced in every lane prompt, and a reported lane collision is a P0.

**The split matters.** The critic is a backstop. Quality comes from `ui-builder` knowing the rules
before the first edit — the alternative is making the same mistakes, catching them, and reworking,
which is what four rejected rebuilds of `/demo` cost.

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
- Model: `sonnet` is the default for harness operators (cost / quality balance). Exception: `test-author` runs `opus` — deciding *which* tests are worth writing is judgment work, and a cheap model defaults to coverage padding.

## Kimi Code reads this same directory

[Kimi Code](https://moonshotai.github.io/kimi-code/) (`kimi`) discovers project sub-agents from
`.kimi-code/agents`, which in this repo is a **symlink onto this directory** — the same way
`CLAUDE.md` symlinks to `AGENTS.md`. One file defines an agent for both CLIs; a new agent added here
shows up in `kimi` with no second step. Verified with `kimi --agent <bogus>`, which prints the
discovered roster. `scripts/harness-check.sh` (check D2) fails if the symlink is missing or replaced
by a real directory, because a copy drifts the moment either side is edited.

What does *not* carry over:

- **`model:`** — Kimi's field is `model_preference`, so a Claude `model: opus` line is ignored and the
  agent runs on Kimi's configured model. Unknown frontmatter keys are skipped, not rejected.
- **Claude-only tool names** in `tools:` (e.g. `Task`, MCP tools). `Read`/`Write`/`Edit`/`Glob`/`Grep`/`Bash`
  are named identically in both, so the read-only agents stay read-only.
- **`README.md`** (this file) has no frontmatter, so Kimi logs one `Skipping invalid agent file`
  WARN per session and moves on. Harmless; not worth adding fake frontmatter to silence.

Slash commands, hooks and skills are **not** shared — those live under `.claude/` in a
Claude-specific format.

## When to add a new sub-agent

Only when:
- The task recurs frequently
- The instructions are long enough that the main thread benefits from offloading
- The output is structured enough to consume back as tool result

Otherwise: do it in the main thread. More agents ≠ better harness.
