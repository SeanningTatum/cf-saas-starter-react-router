#!/usr/bin/env bash
# Harness bootstrap. Run at start of any non-trivial agent session to capture baseline.
# Idempotent. Reads-only beyond installing deps + applying local migrations.
#
# Usage:
#   ./init.sh             # full bootstrap (install + typegen + migrate + typecheck + test)
#   ./init.sh --quick     # skip install + migrate (assume already done)
#   ./init.sh --baseline  # only typecheck + test (used by 00-before-task.md)

set -uo pipefail

MODE="${1:-full}"

echo "=== Harness init ($MODE) ==="
echo "Repo: $(pwd)"
echo "Branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'no-git')"
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

if [ "$MODE" != "--baseline" ] && [ "$MODE" != "--quick" ]; then
  echo "--- Install dependencies ---"
  bun install || { echo "FAIL: bun install"; exit 1; }
  echo ""

  echo "--- Apply local D1 migrations ---"
  bun run db:migrate:local || { echo "FAIL: db:migrate:local"; exit 1; }
  echo ""
fi

echo "--- Typecheck ---"
TC_OUT=$(bun run typecheck 2>&1)
TC_RC=$?
echo "$TC_OUT" | tail -5
[ $TC_RC -ne 0 ] && echo "FAIL: typecheck (rc=$TC_RC)" || echo "OK: typecheck"
echo ""

echo "--- Unit tests ---"
TEST_OUT=$(bun run test 2>&1)
TEST_RC=$?
echo "$TEST_OUT" | tail -10
[ $TEST_RC -ne 0 ] && echo "FAIL: test (rc=$TEST_RC)" || echo "OK: test"
echo ""

echo "--- Harness invariants ---"
HARNESS_OUT=$(./scripts/harness-check.sh 2>&1)
HARNESS_RC=$?
echo "$HARNESS_OUT" | tail -8
[ $HARNESS_RC -ne 0 ] && echo "FAIL: harness-check (rc=$HARNESS_RC)" || echo "OK: harness-check"
echo ""

echo "=== Baseline summary ==="
echo "typecheck:     $([ $TC_RC -eq 0 ] && echo PASS || echo FAIL)"
echo "test:          $([ $TEST_RC -eq 0 ] && echo PASS || echo FAIL)"
echo "harness-check: $([ $HARNESS_RC -eq 0 ] && echo PASS || echo FAIL)"
echo ""
echo "Brain entry points:"
echo "  - CLAUDE.md (read first)"
echo "  - .brain/HARNESS.md (this harness explained)"
echo "  - .brain/recipes/00-before-task.md (start every task here)"
echo "  - .brain/features/feature_list.json (feature state)"
echo "  - .brain/runs/progress.md (rolling session log)"
echo ""

if [ $TC_RC -ne 0 ] || [ $TEST_RC -ne 0 ] || [ $HARNESS_RC -ne 0 ]; then
  echo "Pre-existing failures detected. Record them in your run note before changing anything."
  exit 1
fi

echo "Baseline green. Proceed to task."
