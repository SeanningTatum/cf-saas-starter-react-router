---
description: Close out an in-progress feature — verify-done + brain ship (flip + checkpoint + brain check) + update feature MD + close run note
---

Ship the in-progress feature. Refuse if more than one is in progress, or if `/verify-done` would fail. The **brain-axi CLI drives the state flip** — `brain ship` requires evidence, runs a screenshot check, appends a checkpoint, then runs `brain check`.

Steps:

1. **Identify** the feature: `brain features --status in-progress`. If zero — stop, tell user "no feature in progress." If two or more — stop, tell user to pick one explicitly.

2. **Run** `/verify-done` (the slash command, full checklist). If any row is ❌ — stop, tell the user to fix before shipping. Do not proceed.

3. **Update per-feature MD** (`.brain/features/<slug>/<slug>.md`):
   - Bump `_Last updated: YYYY-MM-DD_`.
   - Append a Changelog row: `| YYYY-MM-DD | shipped | <one-line summary of what changed> |`.

4. **Produce the verification doc** if a user-visible flow changed and one isn't current — follow `brain playbook verify` (feature-verifier browser walk → `.brain/features/<slug>/verifications/<date>.md` with a PASS Verdict). `brain ship` warns on zero verification docs.

5. **Ship via the CLI**:
   - `brain ship <slug> --evidence "shipped YYYY-MM-DD; tests: <paths>; e2e: <pass/skipped reason>; verify: <doc path>"`
   - This flips `feature_list.json` to `shipped`, screenshot-checks, appends a `brain progress` checkpoint, and runs `brain check`. Source evidence from the verify-done report — do not invent.
   - If it exits non-zero — stop, surface the violation; the ship is incomplete.

6. **Sync the human-facing index** — `brain ship` updates `feature_list.json` (authoritative) but not the mirror table in `.brain/features/index.md`. Flip that feature's **Status** column to `shipped` and bump its **Last updated** date so the index doesn't disagree with the tracker.

7. **Close the run note** if one was opened: `brain runs append <slug> --step "shipped" --observed "<evidence + commit SHA(s)>"`.

8. **Report**:
   ```
   Shipped: <slug> <name>
   Evidence: <one-line>
   Files updated: feature_list.json (via brain ship), features/<slug>/<slug>.md, features/index.md, runs/progress.md (via brain ship), run note (if existed)
   brain check: PASS

   Next: commit & push, or pick up next feature.
   ```

Do not commit. The user owns the commit step.
