---
description: Close out an in-progress feature — verify-done + flip feature_list status + update feature MD + close run note + harness-check
---

Ship the in-progress feature. Refuse if more than one is in progress, or if `/verify-done` would fail.

Steps:

1. **Read** `.brain/features/feature_list.json`. Identify the feature with `status: "in-progress"`. If zero — stop, tell user "no feature in progress." If two or more — stop, tell user to pick one explicitly.

2. **Run** `/verify-done` (the slash command, full checklist). If any row is ❌ — stop, tell the user to fix before shipping. Do not proceed.

3. **Update `feature_list.json`**:
   - Flip `status` from `"in-progress"` to `"shipped"`.
   - Set `evidence` to a one-line factual string: e.g. `"shipped 2026-MM-DD; tests: <paths>; e2e: <pass/skipped reason>"`. Source from the verify-done report — do not invent.
   - Bump top-level `updated` field to today's date.

4. **Update per-feature MD** (`.brain/features/<slug>.md`):
   - Bump `_Last updated: YYYY-MM-DD_`.
   - Append a Changelog row: `| YYYY-MM-DD | shipped | <one-line summary of what changed> |`.

5. **Update `features/index.md`** table — flip Status column to `shipped` and bump Last updated date.

6. **Close the run note** (`.brain/runs/<date>-<slug>.md`) if one was opened:
   - Append final entry: outcome, evidence link, commit SHA(s).
   - Set `Status: shipped` in the header.

7. **Append to `progress.md`** — newest entry on top, format per file's documented template. `next:` line states what's next or `idle`.

8. **Run** `./scripts/harness-check.sh`. Must exit zero. If it fails — stop, surface the violation; the ship is incomplete.

9. **Report**:
   ```
   Shipped: <feat-id> <name>
   Evidence: <one-line>
   Files updated: feature_list.json, features/<slug>.md, features/index.md, runs/progress.md, runs/<date>-<slug>.md (if existed)
   harness-check: PASS

   Next: commit & push, or pick up next feature.
   ```

Do not commit. The user owns the commit step.
