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

# name|command|in baseline (y/n)|time limit (s)
GATES='typecheck|bun run typecheck|y|600
test|bun run test|y|600
non-negotiables-selftest|bun run scripts/check-non-negotiables.ts --selftest|y|300
non-negotiables|bun run scripts/check-non-negotiables.ts|y|300
harness|./scripts/harness-check.sh|y|300
build|bun run build|n|900
e2e|bun run test:e2e|n|900'

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
    printf '%s\n' "$GATES" | awk -F'|' '{ printf "%-26s %-10s %5ss  %s\n", $1, ($3 == "y" ? "baseline" : "full"), $4, $2 }'
    exit 0
    ;;
  *) echo "usage: $0 [--baseline | --only <gate> | --list]" >&2; exit 2 ;;
esac

if [ "$MODE" = "only" ] && ! printf '%s\n' "$GATES" | cut -d'|' -f1 | grep -qx "$ONLY"; then
  echo "unknown gate: $ONLY (see $0 --list)" >&2
  exit 2
fi

# Run a command under a time limit; exit 124 when it runs out. Perl, because macOS has no
# timeout(1). The gate gets its own process group so a hung child dies with it.
run_limited() {
  perl -e '
    my $limit = shift;
    my $pid = fork() // die "fork: $!";
    if ($pid == 0) { setpgrp(0, 0); exec @ARGV or die "exec: $!" }
    my $stop = sub {
      kill "TERM", -$pid;
      for (1 .. 50) { waitpid($pid, 1); last unless kill 0, -$pid; select(undef, undef, undef, 0.1) }
      kill "KILL", -$pid;
    };
    $SIG{INT} = sub { $stop->(); exit 130 };
    $SIG{TERM} = sub { $stop->(); exit 143 };
    $SIG{ALRM} = sub { print STDERR "timed out after ${limit}s\n"; $stop->(); exit 124 };
    alarm $limit;
    waitpid($pid, 0);
    exit($? & 127 ? 128 + ($? & 127) : $? >> 8);
  ' "$@"
}

PASSED=()
FAILED=()

while IFS='|' read -r name run baseline limit; do
  [ -z "$name" ] && continue
  [ "$MODE" = "baseline" ] && [ "$baseline" != "y" ] && continue
  [ "$MODE" = "only" ] && [ "$name" != "$ONLY" ] && continue

  echo "=== $name: $run (limit ${limit}s) ==="
  # stdin from /dev/null: a gate must not read the rest of GATES from this loop's input.
  if run_limited "$limit" bash -c "$run" </dev/null; then
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
