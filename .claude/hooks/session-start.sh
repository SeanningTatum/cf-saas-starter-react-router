#!/usr/bin/env bash
# SessionStart hook: inject live brain state via the brain-axi CLI, then repo pointers.
# Cheap, deterministic, no LLM call. Runs once per session start.

set -uo pipefail

# --- Live brain state (brain-axi CLI is the source of truth) ---
if command -v brain >/dev/null 2>&1; then
  echo "🧠 brain context:"
  brain context 2>/dev/null || true
  echo ""
fi

cat <<'EOF'
🧠 Harness loaded — brain-axi CLI is the interface. Read before non-trivial work:

  brain              — dashboard (feature counts, in-progress, last checkpoint)
  brain progress     — rolling session cursor (where you left off)
  brain features     — feature state (status + dependencies)
  brain docs         — rules / recipes / architecture / codebase docs
  brain search "..." — find text anywhere in the brain

Anchors: .brain/HARNESS.md (how the harness works) · CLAUDE.md (5 non-negotiables).

For non-trivial code changes:
  - /start-task to kick off (baseline + brain read + framing)
  - Open the matching recipe: brain docs recipes
  - End with /verify-done (typecheck/test/e2e/build/feature-verify + brain check)
  - Flip feature state: brain features set-status <slug> --status <...>
EOF

exit 0
