#!/usr/bin/env bash
# Run the repo's gates. Deterministic, no LLM. Exit non-zero if any gate fails.
#
# This file is the one list of gates: CI, init.sh, the workflows and AGENTS.md all
# run it, so adding a gate is one line in GATES below.
#
# Usage:
#   ./scripts/verify.sh               # every gate
#   ./scripts/verify.sh --baseline    # the quick set (no build, no e2e)
#   ./scripts/verify.sh --only build  # one gate by name
#   ./scripts/verify.sh --list        # print the gates and stop

set -uo pipefail

cd "$(dirname "$0")/.."

# name|command|in baseline (y/n)
GATES='typecheck|bun run typecheck|y
test|bun run test|y
non-negotiables-selftest|bun run scripts/check-non-negotiables.ts --selftest|y
non-negotiables|bun run scripts/check-non-negotiables.ts|y
harness|./scripts/harness-check.sh|y
build|bun run build|n
e2e|bun run test:e2e|n'

MODE="all"
ONLY=""
case "${1:-}" in
  "") ;;
  --baseline) MODE="baseline" ;;
  --only)
    MODE="only"
    ONLY="${2:-}"
    [ -n "$ONLY" ] || { echo "usage: $0 --only <gate>" >&2; exit 2; }
    ;;
  --list)
    printf '%s\n' "$GATES" | awk -F'|' '{ printf "%-26s %-10s %s\n", $1, ($3 == "y" ? "baseline" : "full"), $2 }'
    exit 0
    ;;
  *) echo "usage: $0 [--baseline | --only <gate> | --list]" >&2; exit 2 ;;
esac

if [ "$MODE" = "only" ] && ! printf '%s\n' "$GATES" | cut -d'|' -f1 | grep -qx "$ONLY"; then
  echo "unknown gate: $ONLY (see $0 --list)" >&2
  exit 2
fi

PASSED=()
FAILED=()

while IFS='|' read -r name run baseline; do
  [ -z "$name" ] && continue
  [ "$MODE" = "baseline" ] && [ "$baseline" != "y" ] && continue
  [ "$MODE" = "only" ] && [ "$name" != "$ONLY" ] && continue

  echo "=== $name: $run ==="
  # stdin from /dev/null: a gate must not read the rest of GATES from this loop's input.
  if bash -c "$run" </dev/null; then
    PASSED+=("$name")
  else
    FAILED+=("$name")
  fi
  echo ""
done <<<"$GATES"

echo "=== Summary ==="
[ ${#PASSED[@]} -gt 0 ] && printf '  ✓ %s\n' "${PASSED[@]}"
[ ${#FAILED[@]} -gt 0 ] && printf '  ✗ %s\n' "${FAILED[@]}"

if [ ${#FAILED[@]} -gt 0 ]; then
  echo "FAIL: ${#FAILED[@]} gate(s) red"
  exit 1
fi
echo "PASS: ${#PASSED[@]} gate(s) green"
