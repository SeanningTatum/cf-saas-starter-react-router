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
# the same directory. CONTEXT_MEMORY_DIR overrides the whole path.
#
# Usage:
#   ./scripts/memory-dir.sh        # print (and create) the directory

set -euo pipefail

if [ -n "${CONTEXT_MEMORY_DIR:-}" ]; then
  DIR="$CONTEXT_MEMORY_DIR"
else
  COMMON=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || {
    echo "memory-dir: not inside a git repository (set CONTEXT_MEMORY_DIR)" >&2
    exit 1
  }
  ROOT=$(dirname "$COMMON")
  SLUG=$(printf '%s' "$ROOT" | sed 's/[^A-Za-z0-9]/-/g')
  DIR="$HOME/.claude/projects/$SLUG/memory/features"
fi

mkdir -p "$DIR"
printf '%s\n' "$DIR"
