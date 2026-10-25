#!/usr/bin/env bash
# SessionStart hook: restore agent skills, build or sync the CodeGraph index, then repo pointers.
# Cheap, deterministic, no LLM call. Runs once per session start.

set -uo pipefail

# --- Agent skills: restore any missing from skills-lock.json, detached (hook timeout is 5s) ---
bash "$(dirname "$0")/../../scripts/restore-skills.sh" --background 2>/dev/null || true

# --- CodeGraph: a new worktree has no index yet; build or sync it, detached ---
bash "$(dirname "$0")/../../scripts/codegraph.sh" ensure --background 2>/dev/null || true

cat <<'EOF'
Harness loaded. Before non-trivial work:

  gh issue list --label ready-for-agent  — work to pick up
  ./scripts/verify.sh --baseline         — gates at the start (full ./scripts/verify.sh before done)
  context-memory agent                   — recall <feature> at the start, record once at the end
  ./scripts/codegraph.sh explore "<q>"   — symbols, source and callers before you grep

Planning: /grill-me (or /grill-with-docs) → /to-spec → /to-tickets.

Anchor: CLAUDE.md (5 non-negotiables).
EOF

exit 0
