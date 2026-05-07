---
description: Deterministic task kickoff — runs init.sh baseline, reads brain, frames task, opens run note
---

Run the full `00-before-task.md` init phase deterministically. Do **not** start writing code until every step is done.

Steps:

1. **Run baseline**: execute `./init.sh --baseline`. Paste the verbatim summary tail. If it reports "Pre-existing failures detected" — stop, surface the failures, ask the user how to proceed. Do not edit anything.

2. **Frame the task** (write answers in your reply, then into the run note in step 6):
   - **Intent**: one sentence — what the user is actually asking for (not the literal words).
   - **Domain**: pick exactly one — `architecture | repository | service | route | library | errors | frontend | cloudflare | mixed`.
   - **Scope**: `code only | brain only | both`.
   - **Affects feature(s)**: list `feat-id` from `.brain/features/feature_list.json`, or `none` for non-feature work.
   If you cannot answer any of these confidently, ask the user one clarifying question and stop.

3. **Read the brain** in this order (do not skim, read):
   - `.brain/HARNESS.md` (only if not read this session)
   - `CLAUDE.md` (only if not read this session)
   - `.brain/<domain>/index.md` for the chosen domain
   - Every triggered file from that index
   - For feature work: matching `.brain/features/<slug>.md`
   - Most recent relevant entry in `.brain/runs/progress.md`

4. **Pick the runbook**:
   - If adding code that matches a recipe — name it (`add-trpc-endpoint.md`, `add-db-table.md`, `add-tagged-error.md`, `add-cf-binding.md`, `add-feature.md`, `add-route.md`, `add-service.md`).
   - If pure refactor / bugfix — name the rule file in `.brain/rules/` for the layer touched.
   - State the choice explicitly.

5. **Check scope policy**:
   - Run: `jq '[.features[] | select(.status=="in-progress")] | length' .brain/features/feature_list.json`.
   - If count > 1 — refuse. Tell the user which features are in progress and require they `block` one before starting another.
   - If count == 1 and the in-progress feature ≠ the affected feature — flag it. Either continue that feature or block it before starting new work.

6. **Open run note** (required for tasks expected to span >30 min or multi-session, optional otherwise):
   - Filename: `.brain/runs/$(date +%Y-%m-%d)-<task-slug>.md`
   - Copy from `.brain/runs/_TEMPLATE.md`
   - Fill `Task`, `Domain`, `Plan`, `Baseline` sections from the steps above.

7. **Append to progress.md** (always — even for trivial tasks):
   - One entry at the top of `.brain/runs/progress.md` using the format already shown in that file.
   - Set `next:` to the first concrete edit you'll make.

8. **State readiness** in your final reply:
   - `Ready to work on: <task summary>`
   - `Recipe / rule: <path>`
   - `Run note: <path or "none — trivial">`
   - `Affected feature(s): <feat-ids or "none">`
   - `Baseline: PASS`

Only after all 8 steps done — and the user has not redirected — proceed to actual code edits.
