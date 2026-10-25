#!/usr/bin/env bash
# Tests for scripts/codegraph.sh — CodeGraph is optional, so `ensure` must build or sync the
# index when a CLI exists and never fail its caller when one does not.
# Deterministic, offline: a stub `codegraph` on PATH records its arguments.
# Run standalone or via scripts/harness-check.sh.

set -uo pipefail

cd "$(dirname "$0")/.."
REAL=$PWD

PASS=0
FAILED=0

ok()  { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad() { echo "  ✗ $1"; FAILED=$((FAILED+1)); }

SB=$(mktemp -d)
trap 'rm -rf "$SB"' EXIT
SB=$(cd "$SB" && pwd -P)

# A throwaway repo holding a copy of the script, so ROOT resolves to it.
REPO="$SB/repo"
mkdir -p "$REPO/scripts"
cp scripts/codegraph.sh "$REPO/scripts/"
git init -q "$REPO"

# Stub CLI: log every call; exit with $STUB_RC.
mkdir -p "$SB/bin"
cat >"$SB/bin/codegraph" <<'EOF'
#!/bin/sh
echo "$*" >>"$STUB_LOG"
exit "${STUB_RC:-0}"
EOF
chmod +x "$SB/bin/codegraph"
export STUB_LOG="$SB/calls.log"
BASE_PATH="/usr/bin:/bin"

run() { env PATH="$SB/bin:$BASE_PATH" "$@"; }

# Catches: a new checkout (a fresh worktree) left with no index.
: >"$STUB_LOG"
run "$REPO/scripts/codegraph.sh" ensure >/dev/null
grep -qx "init --yes $REPO" "$STUB_LOG" && ok "ensure builds the index when none exists" \
  || bad "ensure without an index ran: $(cat "$STUB_LOG")"

# Catches: a full rebuild on every session start instead of a cheap sync.
mkdir -p "$REPO/.codegraph" && : >"$REPO/.codegraph/codegraph.db"
: >"$STUB_LOG"
run "$REPO/scripts/codegraph.sh" ensure >/dev/null
grep -qx "sync --quiet $REPO" "$STUB_LOG" && ok "ensure syncs an existing index" \
  || bad "ensure with an index ran: $(cat "$STUB_LOG")"

# Catches: the opt-out being ignored.
: >"$STUB_LOG"
CODEGRAPH=0 run "$REPO/scripts/codegraph.sh" ensure >/dev/null
[ ! -s "$STUB_LOG" ] && ok "CODEGRAPH=0 runs nothing" || bad "CODEGRAPH=0 still ran: $(cat "$STUB_LOG")"

# Catches: a broken CodeGraph failing init.sh or the SessionStart hook.
if STUB_RC=1 run "$REPO/scripts/codegraph.sh" ensure >/dev/null 2>&1; then
  ok "a failing codegraph does not fail ensure"
else
  bad "ensure exited non-zero when codegraph failed"
fi

# Catches: a fork with neither codegraph nor npx getting a failed setup.
if OUT=$(env PATH="$BASE_PATH" "$REPO/scripts/codegraph.sh" ensure 2>&1); then
  grep -q "fall back to rg" <<<"$OUT" && ok "no codegraph and no npx: warns, exits 0" \
    || bad "no-tool ensure printed: $OUT"
else
  bad "ensure exited non-zero with no codegraph and no npx"
fi

# Catches: the MCP server indexing whatever directory the client started in.
: >"$STUB_LOG"
(cd "$SB" && run "$REPO/scripts/codegraph.sh" serve --mcp >/dev/null)
grep -qx "serve --path $REPO --mcp" "$STUB_LOG" && ok "serve pins the project path" \
  || bad "serve ran: $(cat "$STUB_LOG")"

# Catches: the binary index showing up in git status.
git -C "$REAL" check-ignore -q .codegraph/codegraph.db && ok ".codegraph/ is gitignored" \
  || bad ".codegraph/ is not gitignored"

# Catches: .mcp.json bypassing the wrapper, so a fork without a global install gets a dead server.
grep -q 'scripts/codegraph.sh' "$REAL/.mcp.json" && ok ".mcp.json starts the server through scripts/codegraph.sh" \
  || bad ".mcp.json does not use scripts/codegraph.sh"

echo ""
echo "codegraph: $PASS passed, $FAILED failed"
[ "$FAILED" -eq 0 ]
