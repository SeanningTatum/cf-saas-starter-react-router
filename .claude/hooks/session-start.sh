#!/usr/bin/env bash
# SessionStart hook: print harness pointers so agent reads brain before working.
# Cheap, deterministic, no LLM call. Runs once per session start.

set -uo pipefail

cat <<'EOF'
🧠 Harness loaded — read these before non-trivial work:

  1. .brain/HARNESS.md             — what this harness is and how to use it
  2. CLAUDE.md                      — brain pointer (5 non-negotiables)
  3. .brain/recipes/00-before-task.md — task init checklist
  4. .brain/runs/progress.md        — rolling session cursor (where you left off)
  5. .brain/features/feature_list.json — feature state (status + dependencies)

For non-trivial code changes:
  - Open matching recipe in .brain/recipes/
  - End with /verify-done or .brain/recipes/99-verify-done.md
  - Update .brain/features/feature_list.json status field if scope changes
EOF

exit 0
