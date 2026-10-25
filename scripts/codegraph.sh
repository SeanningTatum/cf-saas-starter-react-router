#!/usr/bin/env bash
# Run CodeGraph for this checkout: the installed `codegraph` when it is on PATH, else a pinned
# copy through npx, so a fork needs no global install. The index (.codegraph/) belongs to one
# checkout and is gitignored; every worktree builds its own.
#
# CodeGraph is optional. `ensure` never fails its caller, and CODEGRAPH=0 skips it.
#
# Usage:
#   scripts/codegraph.sh ensure               # build the index if missing, else sync it (init.sh)
#   scripts/codegraph.sh ensure --background  # the same, detached (SessionStart hook)
#   scripts/codegraph.sh <command> [args...]  # any codegraph command: explore "<q>", serve --mcp

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="@colbymchenry/codegraph@1.6.2"

cg() {
  if command -v codegraph >/dev/null 2>&1; then
    codegraph "$@"
  elif command -v npx >/dev/null 2>&1; then
    npx -y "$PKG" "$@"
  else
    echo "codegraph: neither codegraph nor npx is on PATH" >&2
    return 127
  fi
}

ensure() {
  if [ "${CODEGRAPH:-1}" = "0" ]; then
    echo "codegraph: skipped (CODEGRAPH=0)"
    return 0
  fi
  if [ -f "$ROOT/.codegraph/codegraph.db" ]; then
    cg sync --quiet "$ROOT" && echo "codegraph: synced" && return 0
  else
    cg init --yes "$ROOT" >/dev/null && echo "codegraph: indexed" && return 0
  fi
  echo "codegraph: WARN index not built; agents fall back to rg" >&2
  return 0
}

case "${1:-}" in
  "")
    echo "usage: $0 ensure [--background] | <codegraph command> [args...]" >&2
    exit 2
    ;;
  ensure)
    if [ "${2:-}" = "--background" ]; then
      # Lock and log sit in this checkout's git dir: per worktree, never in the tree.
      GITDIR=$(git -C "$ROOT" rev-parse --absolute-git-dir 2>/dev/null) || exit 0
      LOCKDIR="$GITDIR/codegraph.lock"
      mkdir "$LOCKDIR" 2>/dev/null || exit 0
      (trap 'rmdir "$LOCKDIR"' EXIT; ensure) >"$GITDIR/codegraph.log" 2>&1 </dev/null &
      disown 2>/dev/null || true
      exit 0
    fi
    ensure
    ;;
  serve)
    shift
    # MCP servers start with no cwd guarantee; pin the project path.
    if command -v codegraph >/dev/null 2>&1; then
      exec codegraph serve --path "$ROOT" "$@"
    fi
    exec npx -y "$PKG" serve --path "$ROOT" "$@"
    ;;
  *)
    cg "$@"
    ;;
esac
