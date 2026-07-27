# Run: rule-router-hook

_Started: 2026-07-27_
_Status: shipped_

## Task

User asked whether `.brain/rules/` would be better off as Claude-specific rules. Answer: no — but the
question exposed a real gap (nothing *triggers* the right layer rule before an edit), so build the
Claude-native trigger instead of moving the rules.

## Domain

mixed (harness / lifecycle)

## Decision — why not move the rules

| Option | Verdict |
|--------|---------|
| Rules inline in `CLAUDE.md` | Rejected. 1688 lines across 7 rules, always-on, taxed on every trivial task. |
| Rules as `.claude/skills/` | Rejected. Description-triggered = still model discretion (the existing gap), Claude-only, duplicates the `brain docs` / `brain search` retrieval path, and `brain check` would not validate the copies. |
| Rules stay in `.brain/`, hook triggers them | **Chosen.** Deterministic, path-matched, single source of truth. |

Two structural reasons beyond the mechanics:

1. `.brain/` is deliberately tool-agnostic — `CLAUDE.md` is a symlink to `AGENTS.md` so Cursor / Codex /
   Aider read the same content. A `.claude/`-only rules folder breaks that contract.
2. It would reverse the 2026-05-07 consolidation, which moved *away* from `.cursor/rules/*.mdc` for
   exactly this reason (see the old→new map at the bottom of `.brain/rules/index.md`).

Claude Code has no glob-scoped rules format. The nearest primitive with deterministic path matching is
a hook — so the hook is the port of Cursor's `globs:` frontmatter, not a port of the rules themselves.

## Plan

1. `.claude/hooks/rule-router.sh` — `PreToolUse(Edit|Write|NotebookEdit)`, path → layer rule.
2. Register in `.claude/settings.json`.
3. Tests for the mapping; wire into `scripts/harness-check.sh` so CI enforces glob-table sync.
4. Verify end-to-end that the injected context actually reaches the model.
5. Brain docs: `rules/index.md`, `HARNESS.md`, `AGENTS.md`, `CHANGELOG.md`.

## Baseline

Baseline captured after the change (build began before `init.sh --baseline`); no app code was touched,
so `typecheck` + `test` are unchanged from `main`:

```
$ bun run typecheck
typecheck exit: 0

$ bun run test
Test Files  23 passed (23)
     Tests  228 passed (228)
```

---

## Step 1 — the hook

_2026-07-27_

What I did: `case`-table mapping repo-relative path → layer rule, mirroring the **Touches** column of
`.brain/rules/index.md`. Emits `hookSpecificOutput.additionalContext` with **pointers only** (rule
bodies are 142–328 lines each — the agent reads them with `brain docs view`). Multi-layer paths emit
every hit. Dedupes once per layer per session via marker files under `$TMPDIR`, pruned after a day.

Design constraints I held to:

- `jq` for payload parsing, never `grep`/`sed` — `tool_input.old_string` contains arbitrary user code.
- Silent no-op on unmatched path, missing `jq`, empty/malformed stdin. Never blocks an edit.
- Skips a rule whose doc no longer exists, so a rename cannot produce a dangling pointer.

## Step 2 — does the injected context actually reach the model?

_2026-07-27_

`PreToolUse` plain stdout goes to the **transcript only**, not the model. Confirmed
`hookSpecificOutput.additionalContext` is handled generically in the hook-result path of the 2.1.220
binary (alongside `permissionDecision`), then proved it with two headless `claude -p` probes.

Probe 2 returned the injected text verbatim:

```
PreToolUse:Write hook additional context: 🧠 Layer rules for `app/repositories/__hook_probe2.ts` (first touch of this layer this session):
  - .brain/rules/repository.md — Effect.Service repositories, Drizzle schema, repo input schemas
```

What I learned — **timing caveat**: the context lands on the turn *after* the tool call, not before it.
Probe 1's sub-agent read it as "I should have read the layer rules before editing." So the hook governs
subsequent edits and prompts a re-check of the one just made; it is not a pre-edit block. True pre-edit
delivery would need `permissionDecision: "ask"`, which halts the flow on every first-touch edit —
rejected. The injected wording now states the timing instead of pretending otherwise.

## Step 3 — two pre-existing bugs in `brain-reminder.sh`

_2026-07-27_

Found while testing, both fixed:

1. **`declare -A` on bash 3.2.** macOS ships bash 3.2, where `declare -A` degrades to an indexed array;
   `["app/db/schema.ts"]=...` is then evaluated arithmetically and `set -u` aborts:

   ```
   ./.claude/hooks/brain-reminder.sh: line 16: app: unbound variable
   ```

   Verified against `git show HEAD:` — the pre-commit reminder had **never** produced output locally.
   Rewritten as a `case` table (same idiom as the new hook).
2. **Invisible even when it ran** — plain `PreToolUse` stdout never reached the model. Now emits
   `additionalContext` too. Dropped the `2>&1` from its `settings.json` command so stderr cannot
   corrupt the JSON envelope.

## Step 4 — tests + CI enforcement

_2026-07-27_

`scripts/test-rule-router.sh` (30 checks) and `scripts/test-brain-reminder.sh` (18 checks): every layer
mapping, multi-layer hits, absolute-path relativization, dedupe, session isolation, hostile `old_string`
(quotes / newlines / shell metachars / embedded JSON), the output contract, degradation on bad input, and
a bash-3.2 regression guard. `brain-reminder` cases run inside throwaway `git init` repos so staging is
real. Both suites are offline and deterministic.

`scripts/harness-check.sh` gained:

- **G** — every hook script referenced by `.claude/settings.json` exists and is executable.
- **H** — both hook suites pass.

CI already runs `harness-check.sh`, so a glob added to `rules/index.md` without the matching `case` arm
(or vice versa) now fails the build.

```
$ ./scripts/harness-check.sh
  ✓ all settings.json hook scripts exist and are executable
  ✓ rule-router hook tests pass (30 checks)
  ✓ brain-reminder hook tests pass (18 checks)
passed: 10
failed: 0
```

## Step 5 — pre-PR Greptile round

_2026-07-27_

First review (on the pre-rebase branch): confidence 5/5, zero formal findings. Second review, after
rebasing onto current `origin/main`: confidence 3/5, **3 findings**, all real.

1. **`find -mtime +1` could delete the live session's marker dir.** Greptile proposed reordering the
   prune before `mkdir -p`. I wrote the regression test first — and it **failed against that fix**: if
   the *live* session's own dir is stale (open >24h, all markers written on day one), pruning before
   `mkdir` deletes it just as surely as pruning after. The actual fix is to exclude the current
   session from the prune (`! -name "$SESSION"`), plus `touch` so a dir ages out a day after its
   *last* edit rather than its first. Worth remembering: the suggested fix was directionally right
   and materially incomplete — the test is what caught the difference.
2. **Unescaped dots in `brain-reminder.sh`'s grep patterns.** `^app/db/schema.ts` is a BRE, so `.` is
   a wildcard and a staged `app/db/schema_ts` would match. Dots now escaped.
3. **Prune forked `find` even when `$STATE_ROOT` did not exist.** Added a `[ -d ]` guard.

Triaged 1 as P2 rather than P1 (Greptile's label): no security / payments / migration / API-break /
ambiguity trigger, bounded single-concern fix, and Greptile's own reasoning said "safe to merge with
the ordering fixed". 3 auto-fixed, 0 escalated. Suites: 48 → **55 checks** (35 rule-router, 20
brain-reminder).

---

## Final

_Closed: 2026-07-27_

- Shipped: branch `harness/rule-router-hook` (see PR)
- Brain docs updated: `rules/index.md` (new "Auto-surfacing" section + sync warning), `HARNESS.md`
  (§1 Instructions, §3 Verification, §5 Lifecycle, slash-command surface), `AGENTS.md` (§5 Lifecycle +
  auto-surface callout, harness-check descriptions), `CHANGELOG.md`
- Left undone: none
- Surprises worth remembering:
  - `PreToolUse` stdout is transcript-only. Hooks that need to influence the model **must** emit
    `hookSpecificOutput.additionalContext` — and it arrives on the turn *after* the tool call.
  - macOS bash is **3.2**. No `declare -A`, no `mapfile`. Any hook using them dies silently under
    `set -u`. Use `case` tables. Both hook suites now guard this.
  - `mkdir -p` on an existing directory does **not** refresh its mtime, so any `find -mtime`
    reaper must exclude the live session explicitly — reordering the calls is not enough.
  - A path used as a `grep` pattern is a regex. `.` in `schema.ts` / `wrangler.jsonc` is a
    wildcard unless escaped.
