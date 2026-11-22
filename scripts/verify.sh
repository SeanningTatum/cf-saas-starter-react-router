#!/usr/bin/env bash
# Run the repo's gates. Deterministic, no LLM. Exit non-zero if any gate fails.
#
# This file is the one list of gates: CI, init.sh, the workflows and AGENTS.md all
# run it, so adding a gate is one line in GATES below.
#
# Usage:
#   ./scripts/verify.sh                  # every gate
#   ./scripts/verify.sh --baseline       # the quick set (no build, no e2e)
#   ./scripts/verify.sh --lean           # typecheck, lint and unit tests: CI's job on a stacked PR
#   ./scripts/verify.sh --changed [base] # only what the diff against base needs (a stacked change)
#   ./scripts/verify.sh --only build     # one gate by name
#   ./scripts/verify.sh --list           # print the gates and stop
#
# --changed runs typecheck, the house linter on the changed files (not the whole-tree baseline
# ratchet or the rules' self-test), the unit tests related to them and the e2e specs the test
# map ties to them. The base defaults to the pull request's
# target, else the default branch (scripts/lint/base-ref.ts). A change to a gate script,
# scripts/lint, a config file, a workflow, the harness or the lockfile runs every gate instead.
# scripts/verify-changed.ts prints the plan; scripts/lib/verify-plan.ts holds its rules.

set -uo pipefail

cd "$(dirname "$0")/.."

# name|command|tier|time limit (s)
# tier: lean (also runs in baseline and full), baseline (also in full), full.
# e2e runs with CI=1: without it the dev server opens a remote-bindings session that needs a Cloudflare
# login, so the gate is red on any machine that is not logged in (vite.config.ts, remoteBindings).
GATES='typecheck|bun run typecheck|lean|600
test|bun run test|lean|600
non-negotiables-selftest|bun run scripts/check-non-negotiables.ts --selftest|lean|300
non-negotiables|bun run scripts/check-non-negotiables.ts|lean|300
migrations|bun run scripts/migration-check.ts|baseline|120
harness|./scripts/harness-check.sh|baseline|300
secrets|bun run scripts/secret-scan.ts|baseline|120
audit|bun run scripts/package-audit.ts|baseline|120
build|bun run build|full|900
e2e|CI=1 bun run test:e2e|full|900'

USAGE="usage: $0 [--baseline | --lean | --changed [base] | --only <gate> | --list]"
MODE="all"
ONLY=""
BASE_ARG=""
case "${1:-}" in
  "") ;;
  --baseline) MODE="baseline" ;;
  --lean) MODE="lean" ;;
  --changed)
    MODE="changed"
    BASE_ARG="${2:-}"
    ;;
  --only)
    MODE="only"
    ONLY="${2:-}"
    [ -n "$ONLY" ] || { echo "usage: $0 --only <gate>" >&2; exit 2; }
    ;;
  --list)
    printf '%s\n' "$GATES" | awk -F'|' '{ printf "%-26s %-10s %5ss  %s\n", $1, $3, $4, $2 }'
    exit 0
    ;;
  *) echo "$USAGE" >&2; exit 2 ;;
esac

if [ "$MODE" = "only" ] && ! printf '%s\n' "$GATES" | cut -d'|' -f1 | grep -qx "$ONLY"; then
  echo "unknown gate: $ONLY (see $0 --list)" >&2
  exit 2
fi

# --changed: swap GATES for the plan's steps, or fall back to every gate. The plan's lines are
# base|<sha (from)>, full|<reason>, run|<gate>|<command> and skip|<gate>|<reason>.
if [ "$MODE" = "changed" ]; then
  if [ -n "$BASE_ARG" ]; then
    PLAN=$(bun scripts/verify-changed.ts "$BASE_ARG") || exit 2
  else
    PLAN=$(bun scripts/verify-changed.ts) || exit 2
  fi
  echo "=== verify --changed ==="
  printf '%s\n' "$PLAN" | awk -F'|' '$1 == "base" { print "  base: " $2 }'
  FULL=$(printf '%s\n' "$PLAN" | awk -F'|' '$1 == "full" { print "    " $2 }')
  if [ -n "$FULL" ]; then
    echo "  running every gate, because of:"
    printf '%s\n' "$FULL"
    echo ""
    MODE="all"
  else
    LEAN=""
    RAN=" "
    while IFS='|' read -r kind name run; do
      [ "$kind" = "run" ] || continue
      limit=$(printf '%s\n' "$GATES" | awk -F'|' -v n="$name" '$1 == n { print $4 }')
      LEAN="${LEAN}${name}|${run}|lean|${limit:-300}"$'\n'
      RAN="${RAN}${name} "
    done <<<"$PLAN"
    PLANNED_SKIPS=$(printf '%s\n' "$PLAN" | awk -F'|' '$1 == "skip" { print $2 }')
    echo "  skipped:"
    printf '%s\n' "$PLAN" | awk -F'|' '$1 == "skip" { printf "    %-26s %s\n", $2, $3 }'
    while IFS='|' read -r name _; do
      case "$RAN" in *" $name "*) continue ;; esac
      printf '%s\n' "$PLANNED_SKIPS" | grep -qx "$name" && continue
      printf '    %-26s %s\n' "$name" "not needed for a stacked change; the full run on the roll-up covers it"
    done <<<"$GATES"
    echo ""
    GATES="$LEAN"
    MODE="all"
  fi
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

while IFS='|' read -r name run tier limit; do
  [ -z "$name" ] && continue
  [ "$MODE" = "baseline" ] && [ "$tier" = "full" ] && continue
  [ "$MODE" = "lean" ] && [ "$tier" != "lean" ] && continue
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
