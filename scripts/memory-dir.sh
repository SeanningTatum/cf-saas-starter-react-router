#!/usr/bin/env bash
# Print the feature-memory directory the context-memory agent reads and writes, creating it.
#
# It sits inside Claude Code's auto-memory folder for this repo,
# ~/.claude/projects/<repo path, non-alphanumerics as "-">/memory/features/, because that
# folder is the one place every worktree of the repo shares. A folder inside a checkout
# fails both ways: a worktree gets its own copy, deleted with the worktree, and a symlink
# back to the main checkout is refused by Claude Code's worktree isolation.
#
# The repo path is the MAIN checkout's (from git's common dir), so every worktree prints
# the same directory. CONTEXT_MEMORY_DIR overrides the store's path, never the index's.
#
# Usage:
#   ./scripts/memory-dir.sh          # print (and create) the store directory
#   ./scripts/memory-dir.sh --index  # print the auto-memory MEMORY.md path
#   ./scripts/memory-dir.sh --link   # print the link to the store's INDEX.md, as MEMORY.md writes it

set -euo pipefail

MODE="${1:-}"
case "$MODE" in
  "" | --index | --link) ;;
  *) echo "usage: $0 [--index | --link]" >&2; exit 2 ;;
esac

# The auto-memory folder: needed for --index and --link even when the store is overridden.
MEMORY=""
if COMMON=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null); then
  ROOT=$(dirname "$COMMON")
  SLUG=$(printf '%s' "$ROOT" | sed 's/[^A-Za-z0-9]/-/g')
  MEMORY="$HOME/.claude/projects/$SLUG/memory"
fi

if [ -n "${CONTEXT_MEMORY_DIR:-}" ]; then
  DIR="$CONTEXT_MEMORY_DIR"
elif [ -n "$MEMORY" ]; then
  DIR="$MEMORY/features"
else
  echo "memory-dir: not inside a git repository (set CONTEXT_MEMORY_DIR)" >&2
  exit 1
fi

if [ "$MODE" != "" ] && [ -z "$MEMORY" ]; then
  echo "memory-dir: not inside a git repository, so there is no MEMORY.md" >&2
  exit 1
fi

mkdir -p "$DIR"
case "$MODE" in
  "") printf '%s\n' "$DIR" ;;
  --index) printf '%s\n' "$MEMORY/MEMORY.md" ;;
  --link)
    # Relative when the store is the default; absolute when an override puts it elsewhere.
    if [ "$DIR" = "$MEMORY/features" ]; then
      printf '%s\n' "features/INDEX.md"
    else
      printf '%s\n' "$(cd "$DIR" && pwd -P)/INDEX.md"
    fi
    ;;
esac
