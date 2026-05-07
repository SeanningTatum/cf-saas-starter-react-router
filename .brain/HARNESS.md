# HARNESS.md — The harness, explained

> One-stop explainer for *what holds this project together for AI agents*. Read this once when joining the repo. Update it when the harness itself changes (not when features change — that's `.brain/features/`).

## What is the harness?

The **harness** is the system *around* the LLM that makes coding agents reliable across sessions. It is not the model, the prompt, or the codebase — it is the scaffolding that keeps agents from forgetting context, drifting from conventions, breaking unrelated code, or stopping at "compiles but wrong."

This repo follows the **5-subsystem framework** from [walkinglabs/learn-harness-engineering](https://github.com/walkinglabs/learn-harness-engineering/tree/main/skills/harness-creator):

```
1. Instructions   →  what to read before working
2. State          →  what's done, in progress, where I left off
3. Verification   →  how to prove a change is correct
4. Scope          →  what counts as "this task" (and what doesn't)
5. Lifecycle      →  bootstrap, session handoff, clean restart
```

Every concrete artifact below maps to one of those five.

---

## 1. Instructions — Recipe Shelf

The agent's reading list. Layered from generic to specific.

| File | Purpose |
|------|---------|
| [`/CLAUDE.md`](../CLAUDE.md) + [`/AGENTS.md`](../AGENTS.md) | Brain pointer at repo root. Mirrored. Lists 5 non-negotiables, scope policy, brain layout. |
| [`.brain/codebase/`](codebase/) | Programming model — Effect TS, helpers, testing patterns, tRPC API surface, i18n |
| [`.brain/high-level-architecture/`](high-level-architecture/) | Macro view — system layers, data flow, security, integrations, user journeys |
| [`.brain/rules/`](rules/) | 7 layer-aligned do/don't rules — frontend, cloudflare, repository, services, routes, library, errors |
| [`.brain/recipes/`](recipes/) | 8 deterministic step-by-step runbooks — bookended by `00-before-task.md` and `99-verify-done.md` |
| [`.brain/features/`](features/) | One MD per shipped/in-progress feature (purpose, runtime flow, key files, changelog) |

**Reading rule**: *retrieval over recall*. Open the matching `index.md` first; it tells you which file(s) apply. Do not rely on training data for project patterns.

---

## 2. State — Prep Station

What is true *right now*.

| File | Purpose | Update cadence |
|------|---------|----------------|
| [`features/feature_list.json`](features/feature_list.json) | Machine-readable feature status, dependencies, evidence. Source of truth for "what's in flight." | On every status change |
| [`runs/progress.md`](runs/progress.md) | Rolling session cursor — newest entry on top, ≤5 lines per checkpoint. Read at session start. | Each meaningful checkpoint |
| [`runs/<YYYY-MM-DD>-<slug>.md`](runs/) | Per-task deep state — baselines, dead ends, decisions, verbatim test output | During the task |
| [`CHANGELOG.md`](CHANGELOG.md) | High-level architectural / brain shifts (NOT code changelog — `git log` is) | On architectural change |
| `features/<slug>.md` "Changelog" table | Per-feature behaviour changes | On every behavior change to feature |

**Two-layer rule**: `progress.md` is "where am I right now"; `runs/<slug>.md` is "everything I learned doing this task." First is read at session start, second when continuing a specific task.

---

## 3. Verification — Quality Check Window

Externalises "am I done?" so the agent does not declare victory on a half-built feature.

| Tool | Purpose |
|------|---------|
| [`recipes/99-verify-done.md`](recipes/99-verify-done.md) | The full checklist: typecheck → test → e2e (if cross-component) → build (if CF-touching) → manual smoke (if UI) → brain coherence |
| [`/verify-done`](../.claude/commands/verify-done.md) slash command | Same checklist, runnable mid-conversation |
| [`init.sh --baseline`](../init.sh) | Captures pre-change baseline (typecheck + test) so post-change failures aren't blamed on you |
| [`.claude/hooks/brain-reminder.sh`](../.claude/hooks/brain-reminder.sh) | Pre-commit hook listing brain docs the staged paths likely affect (deterministic, no LLM) |

**Verification rule**: green typecheck + green tests is *necessary, not sufficient*. UI changes need a browser walk. CF-binding changes need `bun run build`. Cross-component changes need e2e. Skipping is the single biggest source of premature "done."

---

## 4. Scope — Task Boundaries

What counts as "this task" — and what doesn't.

- **One in-progress feature at a time.** Source: `feature_list.json` `status: "in-progress"` count must be 1.
- **Definition of done** (per CLAUDE.md): impl complete + `/verify-done` green + feature MD updated + `feature_list.json` flipped + run note closed.
- **Cross-feature touch limit**: ≤2 features per diff. More than that = split into separate tasks with separate run notes.
- **Anti-creep heuristic**: if you find yourself "while I'm here…" cleaning up code unrelated to the diff, stop. Open a new task.

---

## 5. Lifecycle — Session Management

Bootstrap, handoff, recovery.

| Step | Tool |
|------|------|
| Session start | SessionStart hook prints harness pointers ([`.claude/hooks/session-start.sh`](../.claude/hooks/session-start.sh)) |
| Project bootstrap | [`./init.sh`](../init.sh) — install + typegen + migrate + typecheck + test |
| Baseline before edit | [`./init.sh --baseline`](../init.sh) — capture green state |
| Task framing | `/start-task` ([`commands/start-task.md`](../.claude/commands/start-task.md)) — runs baseline, reads brain, opens run note, writes progress entry |
| Mid-task checkpoint | Append entry to [`runs/progress.md`](runs/progress.md) |
| Task done | `/verify-done` ([`commands/verify-done.md`](../.claude/commands/verify-done.md)) — full checklist |
| Ship a feature | `/ship-feature` ([`commands/ship-feature.md`](../.claude/commands/ship-feature.md)) — verify-done + flip `feature_list.json` + update feature MD + close run note + harness-check |
| Validate harness | `/harness-check` ([`commands/harness-check.md`](../.claude/commands/harness-check.md)) — runs [`scripts/harness-check.sh`](../scripts/harness-check.sh) (10 deterministic invariants) |
| Pre-commit | [`brain-reminder.sh`](../.claude/hooks/brain-reminder.sh) hook lists brain files to update |
| Architectural shift | Append to [`CHANGELOG.md`](CHANGELOG.md) |

### Slash command surface

```
/start-task    → kickoff (baseline + brain read + framing + run note + progress entry)
/verify-done   → full verification checklist
/ship-feature  → close out an in-progress feature
/harness-check → validate 10 harness invariants (json schema, sync, sub-agents, files, deps)
```

`/harness-check` is the single deterministic gate — runs in seconds, no LLM, exits non-zero on any drift.

---

## Sub-agents — specialised harness operators

Custom subagents in [`.claude/agents/`](../.claude/agents/) wrap pieces of the harness so the main thread can delegate without re-loading rules.

| Agent | Use when |
|-------|----------|
| `brain-navigator` | Read-only locator. Returns "what to read for X task" by walking the brain indexes. |
| `effect-ts-enforcer` | Reviews a diff for the 5 non-negotiables (no `throw`, no Zod, tagged errors mapped, repo/service patterns, no `process.env`). |
| `verify-done-runner` | Runs the full `99-verify-done.md` checklist and reports pass/fail per step. |
| `feature-tracker` | Updates `feature_list.json` + `features/<slug>.md` on status change. Refuses to touch code. |
| `recipe-runner` | Executes one of the 8 `add-*` recipes deterministically. Inputs: recipe name + task params. |

See [`.claude/agents/README.md`](../.claude/agents/README.md) for invocation syntax and full descriptions. Plugin-provided agents (`feature-dev`, `code-review`, `frontend-design`, etc.) are documented in their respective plugin READMEs and are *complementary* to these harness-specific ones.

---

## Five non-negotiables (recap from CLAUDE.md)

1. **Effect TS** is the default. No `throw`, no `try/catch` outside `Effect.tryPromise`.
2. **Effect Schema** for all validation. **No Zod.**
3. **Tagged errors** in `app/models/errors/`. Map in `app/lib/effect-trpc.ts`.
4. **Unit test for every helper and repository.**
5. **Cloudflare Workers, not Node.** Bindings via `CloudflareEnv` Tag. Never `process.env`.

Full detail: [`codebase/effect-ts.md`](codebase/effect-ts.md).

---

## When you change the harness itself

Editing this file, `init.sh`, hooks, sub-agents, or `feature_list.json` schema → append a row to [`CHANGELOG.md`](CHANGELOG.md) under "Brain / harness shifts." Bump the date in [`features/feature_list.json`](features/feature_list.json) `updated` field.

## Further reading

- [walkinglabs/learn-harness-engineering — harness-creator skill](https://github.com/walkinglabs/learn-harness-engineering/tree/main/skills/harness-creator)
- [Anthropic — Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents/)
- [OpenAI — Harness Engineering](https://openai.com/index/harness-engineering/)
