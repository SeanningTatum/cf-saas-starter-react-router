#!/usr/bin/env bash
# Restore agent skills from skills-lock.json into .agents/skills/, then link each into
# .claude/skills/<name> so Claude Code sees it. Both directories are gitignored: the lock is
# the only committed record. Skills that ship as Claude Code plugins live in
# .claude/settings.json (enabledPlugins) instead, not here.
# When every locked skill is already present, it only refreshes the links.
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

locked_names() {
  if command -v jq >/dev/null 2>&1; then
    jq -r '.skills | keys[]' "$LOCK"
  else
    grep -oE '^    "[a-z0-9-]+": \{' "$LOCK" | cut -d'"' -f2
  fi
}

find_missing() {
  local name
  MISSING=()
  for name in $(locked_names); do
    [ -f "$ROOT/.agents/skills/$name/SKILL.md" ] || MISSING+=("$name")
  done
}

# Link every installed skill into .claude/skills/. A link this script made
# (../../.agents/skills/<name>) is dropped when it dangles or its skill has left the lock — the
# folder may outlive the lock entry. Real directories and links pointing anywhere else are never
# touched, even when they dangle.
link_skills() {
  local name link names
  names=$(locked_names)
  mkdir -p "$ROOT/.claude/skills"
  for link in "$ROOT"/.claude/skills/*; do
    [ -L "$link" ] || continue
    name=$(basename "$link")
    [ "$(readlink "$link")" = "../../.agents/skills/$name" ] || continue
    if [ ! -e "$link" ] || ! grep -qx "$name" <<<"$names"; then
      rm "$link"
    fi
  done
  for name in $names; do
    [ -f "$ROOT/.agents/skills/$name/SKILL.md" ] || continue
    [ -e "$ROOT/.claude/skills/$name" ] || ln -s "../../.agents/skills/$name" "$ROOT/.claude/skills/$name"
  done
}

find_missing
if [ ${#MISSING[@]} -eq 0 ]; then link_skills; exit 0; fi

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

# A process's start time; empty when the PID is not running. Two reads of one live process
# must give the same text, or a waiter takes a live owner for a dead one and steals its lock.
# On Linux that rules out `ps -o lstart=`, which ps works out from the clock on each call and
# which can come out a second apart; the kernel's own start tick in /proc does not move.
started() {
  local stat
  if [ -r "/proc/$1/stat" ]; then
    stat=$(cat "/proc/$1/stat" 2>/dev/null) || return 0
    stat=${stat##*) } # the command name may hold spaces; the fields resume after the last ")"
    # shellcheck disable=SC2086
    set -- $stat
    echo "tick ${20}" # field 22 of the full line: start time in clock ticks since boot
  else
    ps -o lstart= -p "$1" 2>/dev/null | awk '{$1=$1; print}'
  fi
}

# Stale = the owner died before cleanup (SIGKILL, crash, reboot), or died between mkdir and
# writing its owner line. The owner line is "<pid> <start time>": a PID alone is not
# identity, since after a reboot or exit it can belong to an unrelated live process.
lock_is_stale() {
  local owner pid start
  [ -d "$LOCKDIR" ] || return 1
  owner=$(cat "$LOCKDIR/owner" 2>/dev/null || true)
  if [ -z "$owner" ]; then
    older_than_2m "$LOCKDIR"
    return
  fi
  pid=${owner%% *}
  start=${owner#* }
  if [ -n "$start" ]; then
    [ "$(started "$pid")" != "$start" ]
  else
    ! kill -0 "$pid" 2>/dev/null # no ps on this host: fall back to liveness alone
  fi
}

# mkdir is atomic, so one restore runs at a time. The owner records who it is, and a stale
# lock is reclaimed instead of blocking every retry. Reclaim happens under a second mutex
# that re-reads the owner inside it: two waiters that saw the same dead PID must not both
# delete, or the second deletes the lock a new owner took in between.
take_lock() {
  if mkdir "$LOCKDIR" 2>/dev/null; then
    # Written via rename so a reader never sees a half-written owner line.
    printf '%s %s\n' $$ "$(started $$)" >"$LOCKDIR/owner.tmp" && mv "$LOCKDIR/owner.tmp" "$LOCKDIR/owner"
    return 0
  fi
  if mkdir "$LOCKDIR.reclaim" 2>/dev/null; then
    if lock_is_stale; then
      # Say whose lock went, so a wrong reclaim can be traced from the log.
      echo "restore-skills: reclaiming a stale lock (owner: $(cat "$LOCKDIR/owner" 2>/dev/null || echo unknown))" >&2
      rm -r "$LOCKDIR" 2>/dev/null
    fi
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
if [ ${#MISSING[@]} -eq 0 ]; then link_skills; exit 0; fi

echo "Restoring ${#MISSING[@]} agent skill(s) from skills-lock.json: ${MISSING[*]}"
cd "$ROOT" && "${RUNNER[@]}" "$SKILLS_CLI" experimental_install -y
status=$?
link_skills
exit $status
