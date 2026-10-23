#!/usr/bin/env bash
# Restore agent skills from skills-lock.json into .agents/skills/. The committed
# .claude/skills/<name> symlinks point there, so Claude Code sees them once restored.
# No-op when every locked skill is already present.
#
# Usage:
#   scripts/restore-skills.sh               # blocking restore (init.sh)
#   scripts/restore-skills.sh --background  # detach and return at once (SessionStart hook)

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCK="$ROOT/skills-lock.json"
SKILLS_CLI="skills@1.7.4"

[ -f "$LOCK" ] || exit 0

if command -v jq >/dev/null 2>&1; then
  NAMES=$(jq -r '.skills | keys[]' "$LOCK")
else
  NAMES=$(grep -oE '^    "[a-z0-9-]+": \{' "$LOCK" | cut -d'"' -f2)
fi

MISSING=()
for name in $NAMES; do
  [ -f "$ROOT/.agents/skills/$name/SKILL.md" ] || MISSING+=("$name")
done
[ ${#MISSING[@]} -eq 0 ] && exit 0

if [ "${1:-}" = "--background" ]; then
  # mkdir is atomic: two sessions starting together run one restore, not two.
  TMP="${TMPDIR:-/tmp}"
  LOCKDIR="${TMP%/}/restore-skills-$(printf '%s' "$ROOT" | cksum | cut -d' ' -f1)"
  mkdir "$LOCKDIR" 2>/dev/null || exit 0
  LOG="$LOCKDIR.log"
  (
    cd "$ROOT" && npx -y "$SKILLS_CLI" experimental_install -y >"$LOG" 2>&1
    rmdir "$LOCKDIR"
  ) </dev/null >/dev/null 2>&1 &
  echo "🎨 Restoring ${#MISSING[@]} agent skill(s) from skills-lock.json in the background (${MISSING[*]}) — log: $LOG"
  exit 0
fi

echo "Restoring ${#MISSING[@]} agent skill(s) from skills-lock.json: ${MISSING[*]}"
cd "$ROOT" && npx -y "$SKILLS_CLI" experimental_install -y
