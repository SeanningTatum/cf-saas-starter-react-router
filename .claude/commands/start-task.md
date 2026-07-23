---
description: Deterministic task kickoff — init.sh baseline, read brain via brain-axi CLI, frame task, open run note
---

Run the full `00-before-task.md` init phase deterministically. Do **not** start writing code until every step is done. The **brain-axi CLI (`brain`) is the interface to brain state** — prefer it over reading raw files.

Steps:

1. **Run baseline**: execute `./init.sh --baseline`. Paste the verbatim summary tail. If it reports "Pre-existing failures detected" — stop, surface the failures, ask the user how to proceed. Do not edit anything.

2. **Orient via the CLI**:
   - `brain` — dashboard (feature counts, in-progress feature, last checkpoint).
   - `brain progress` — latest session checkpoint in full (where you left off, `next:`).

3. **Frame the task** (write answers in your reply, then into the run note in step 7):
   - **Intent**: one sentence — what the user is actually asking for (not the literal words).
   - **Domain**: pick exactly one — `architecture | repository | service | route | library | errors | frontend | cloudflare | mixed`.
   - **Scope**: `code only | brain only | both`.
   - **Affects feature(s)**: `brain features` → list `slug`s, or `none` for non-feature work.
   If you cannot answer any of these confidently, ask the user one clarifying question and stop.

4. **Read the brain** via the CLI (retrieval over recall — do not skim, read):
   - `.brain/HARNESS.md` (only if not read this session)
   - `CLAUDE.md` (only if not read this session)
   - `brain docs <domain>` for the chosen domain, then `brain docs view <section/file>` for each triggered doc
   - `brain search "<keyword>"` to find any rule/recipe/pattern relevant to the task
   - For feature work: `brain features view <slug>`

5. **Pick the runbook**:
   - Adding code that matches a recipe — `brain docs recipes` and name it (`add-trpc-endpoint`, `add-db-table`, `add-tagged-error`, `add-cf-binding`, `add-feature`, `add-route`, `add-service`).
   - Pure refactor / bugfix — name the rule file in `brain docs rules` for the layer touched.
   - State the choice explicitly.

6. **Check scope policy**:
   - Run `brain features --status in-progress`.
   - If count > 1 — refuse; `brain check` will also flag this. Require the user `brain features set-status <slug> --status blocked` on one before starting another.
   - If count == 1 and the in-progress feature ≠ the affected feature — flag it. Continue that feature or block it before starting new work.

7. **Open a run note** (required for tasks expected to span >30 min or multi-session, optional otherwise):
   - For feature work: `brain runs append <slug> --step "kickoff" --observed "<baseline tail>"` creates/opens the per-feature run note.
   - Otherwise copy `.brain/runs/_TEMPLATE.md` → `.brain/runs/$(date +%Y-%m-%d)-<task-slug>.md` and fill `Task`, `Domain`, `Plan`, `Baseline`.

8. **Append a checkpoint**:
   - `brain progress add --summary "<task framing>" --next "<first concrete edit>"` (add `--feature <slug>` and `--run-note <path>` when applicable).

9. **State readiness** in your final reply:
   - `Ready to work on: <task summary>`
   - `Recipe / rule: <name>`
   - `Run note: <path or "none — trivial">`
   - `Affected feature(s): <slugs or "none">`
   - `Baseline: PASS`

Only after all steps done — and the user has not redirected — proceed to actual code edits.
