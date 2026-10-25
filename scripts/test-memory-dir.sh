#!/usr/bin/env bash
# Tests for scripts/memory-dir.sh — the context-memory store must resolve to ONE directory
# for the main checkout and every worktree, outside both, and honour CONTEXT_MEMORY_DIR.
# Deterministic, offline: each case builds a throwaway repo under a fake $HOME.
# Run standalone or via scripts/harness-check.sh.

set -uo pipefail

cd "$(dirname "$0")/.."
SCRIPT=$PWD/scripts/memory-dir.sh

PASS=0
FAILED=0

ok()  { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad() { echo "  ✗ $1"; FAILED=$((FAILED+1)); }

SB=$(mktemp -d)
trap 'rm -rf "$SB"' EXIT
# Resolve /var -> /private/var on macOS so the expected slug matches git's absolute path.
SB=$(cd "$SB" && pwd -P)

export HOME="$SB/home"
mkdir -p "$HOME"
REPO="$SB/my repo.v2"
git init -q "$REPO"
git -C "$REPO" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
git -C "$REPO" worktree add -q "$REPO/.claude/worktrees/wt" -b wt

SLUG=$(printf '%s' "$REPO" | sed 's/[^A-Za-z0-9]/-/g')
WANT="$HOME/.claude/projects/$SLUG/memory/features"

# Catches: the store keyed on the current checkout instead of the repo.
MAIN_OUT=$(cd "$REPO" && CONTEXT_MEMORY_DIR= "$SCRIPT")
[ "$MAIN_OUT" = "$WANT" ] && ok "main checkout resolves to the auto-memory features dir" \
  || bad "main checkout printed '$MAIN_OUT', want '$WANT'"

# Catches: a worktree getting its own store (lost when the worktree is removed).
WT_OUT=$(cd "$REPO/.claude/worktrees/wt" && CONTEXT_MEMORY_DIR= "$SCRIPT")
[ "$WT_OUT" = "$WANT" ] && ok "worktree resolves to the same dir as the main checkout" \
  || bad "worktree printed '$WT_OUT', want '$WANT'"

# Catches: a subdirectory shifting the slug.
SUB_OUT=$(mkdir -p "$REPO/a/b" && cd "$REPO/a/b" && CONTEXT_MEMORY_DIR= "$SCRIPT")
[ "$SUB_OUT" = "$WANT" ] && ok "subdirectory resolves to the same dir" \
  || bad "subdirectory printed '$SUB_OUT', want '$WANT'"

# Catches: printing a path without creating it (callers write straight into it).
[ -d "$WANT" ] && ok "directory is created" || bad "directory $WANT was not created"

# Catches: the store landing inside a checkout, where isolation refuses writes.
case "$WANT" in "$REPO"*) bad "store sits inside the repo" ;; *) ok "store sits outside the repo" ;; esac

# Catches: the override being ignored.
OV_OUT=$(cd "$REPO" && CONTEXT_MEMORY_DIR="$SB/override" "$SCRIPT")
[ "$OV_OUT" = "$SB/override" ] && [ -d "$SB/override" ] && ok "CONTEXT_MEMORY_DIR overrides and is created" \
  || bad "override printed '$OV_OUT'"

# Catches: a silent success outside a repo, which would scatter memory into a bogus dir.
if (cd "$SB" && CONTEXT_MEMORY_DIR= "$SCRIPT" >/dev/null 2>&1); then
  bad "outside a repo it exited 0"
else
  ok "outside a repo it fails"
fi

echo ""
echo "memory-dir: $PASS passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
