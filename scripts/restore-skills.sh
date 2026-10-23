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
# Lock and log live in the gitignored, user-owned .agents/ — not a shared temp dir, where a
# predictable path lets another user plant a symlink for the log or squat the lock.
LOCKDIR="$ROOT/.agents/.restore.lock"
LOG="$ROOT/.agents/.restore.log"

[ -f "$LOCK" ] || exit 0

find_missing() {
  local names name
  if command -v jq >/dev/null 2>&1; then
    names=$(jq -r '.skills | keys[]' "$LOCK")
  else
    names=$(grep -oE '^    "[a-z0-9-]+": \{' "$LOCK" | cut -d'"' -f2)
  fi
  MISSING=()
  for name in $names; do
    [ -f "$ROOT/.agents/skills/$name/SKILL.md" ] || MISSING+=("$name")
  done
}

find_missing
[ ${#MISSING[@]} -eq 0 ] && exit 0

# Bun is the repo's toolchain; fall back to Node for machines that have only npx.
if command -v bunx >/dev/null 2>&1; then
  RUNNER=(bunx)
elif command -v npx >/dev/null 2>&1; then
  RUNNER=(npx -y)
else
  echo "restore-skills: needs bunx (Bun) or npx (Node) on PATH — not restored: ${MISSING[*]}" >&2
  exit 1
fi

mkdir -p "$ROOT/.agents"

if [ "${1:-}" = "--background" ]; then
  # Re-run as its own process rather than a subshell: the lock records the owner's PID,
  # and $$ inside a subshell is the parent's.
  nohup bash "$0" >>"$LOG" 2>&1 </dev/null &
  echo "🎨 Restoring ${#MISSING[@]} agent skill(s) from skills-lock.json in the background (${MISSING[*]}) — log: $LOG"
  exit 0
fi

older_than_2m() { [ -n "$(find "$1" -maxdepth 0 -mmin +2 2>/dev/null)" ]; }

# Stale = the owner died before cleanup (SIGKILL, crash), or died between mkdir and
# writing its PID.
lock_is_stale() {
  local owner
  [ -d "$LOCKDIR" ] || return 1
  owner=$(cat "$LOCKDIR/pid" 2>/dev/null || true)
  if [ -n "$owner" ]; then
    ! kill -0 "$owner" 2>/dev/null
  else
    older_than_2m "$LOCKDIR"
  fi
}

# mkdir is atomic, so one restore runs at a time. The owner writes its PID, and a stale
# lock is reclaimed instead of blocking every retry. Reclaim happens under a second mutex
# that re-reads the owner inside it: two waiters that saw the same dead PID must not both
# delete, or the second deletes the lock a new owner took in between.
take_lock() {
  if mkdir "$LOCKDIR" 2>/dev/null; then
    echo $$ >"$LOCKDIR/pid"
    return 0
  fi
  if mkdir "$LOCKDIR.reclaim" 2>/dev/null; then
    lock_is_stale && rm -r "$LOCKDIR" 2>/dev/null
    rmdir "$LOCKDIR.reclaim"
  elif older_than_2m "$LOCKDIR.reclaim"; then
    rmdir "$LOCKDIR.reclaim" 2>/dev/null # held for milliseconds; this old, its holder died
  fi
  return 1
}

waited=0
until take_lock; do
  if [ $waited -ge 180 ]; then
    echo "restore-skills: another restore still holds $LOCKDIR after 180s — giving up" >&2
    exit 1
  fi
  sleep 1
  waited=$((waited + 1))
done
trap 'rm -r "$LOCKDIR" 2>/dev/null' EXIT
trap 'exit 1' INT TERM HUP

# The restore we waited on may already have installed everything.
find_missing
[ ${#MISSING[@]} -eq 0 ] && exit 0

echo "Restoring ${#MISSING[@]} agent skill(s) from skills-lock.json: ${MISSING[*]}"
cd "$ROOT" && "${RUNNER[@]}" "$SKILLS_CLI" experimental_install -y
