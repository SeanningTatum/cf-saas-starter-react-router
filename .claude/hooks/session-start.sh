#!/usr/bin/env bash
# SessionStart hook: restore agent skills, then repo pointers.
# Live brain state (`brain context`) comes from the brain-axi plugin's own SessionStart hook.
# Cheap, deterministic, no LLM call. Runs once per session start.

set -uo pipefail

# --- Agent skills: restore any missing from skills-lock.json, detached (hook timeout is 5s) ---
bash "$(dirname "$0")/../../scripts/restore-skills.sh" --background 2>/dev/null || true

cat <<'EOF'
🧠 Harness loaded — brain-axi CLI is the interface to .brain/brain.db. Before non-trivial work:

  brain              — dashboard (features, in-progress, last checkpoint)
  brain progress     — checkpoints (where you left off)
  brain features     — feature state
  brain search "..." — find text anywhere in the brain

No .brain/brain.db yet? Run ./scripts/brain-setup.sh (creates it and declares the gates).

For non-trivial code changes:
  - Start with the brain-axi:brain-start skill
  - Gates: brain verify --stage baseline (start) · brain verify (before done)
  - Finish with the brain-axi:brain-done skill; ship with brain features ship <slug> --evidence "..."

Anchor: CLAUDE.md (5 non-negotiables).
EOF

exit 0
