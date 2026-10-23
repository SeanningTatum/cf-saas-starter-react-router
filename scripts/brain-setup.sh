#!/usr/bin/env bash
# Create this checkout's brain and declare the repo's gates in it. Idempotent.
#
# brain-axi 0.3.0 keeps the brain in one gitignored SQLite file, .brain/brain.db,
# so nothing about it arrives with a clone — including the checks `brain verify`
# runs. This script is the tracked source for those checks: init.sh, CI and
# first-time setup all call it, so every checkout declares the same gates.
#
# Usage:
#   ./scripts/brain-setup.sh          # create the db if missing, (re)declare the gates
#   ./scripts/brain-setup.sh --check  # exit 1 if the db's gates differ from GATES below
#
# --check exists because the db outlives a `git pull`: after the list below
# changes, a checkout keeps running its old gates until setup runs again.
# harness-check.sh (itself a baseline gate) runs it, so `brain verify` says so.

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=lib/brain-cli.sh
. scripts/lib/brain-cli.sh

# name|command|stages|timeout (s)
GATES='typecheck|bun run typecheck|bootstrap,baseline,verify|600
test|bun run test|bootstrap,baseline,verify|600
non-negotiables-selftest|bun run scripts/check-non-negotiables.ts --selftest|baseline,verify|300
non-negotiables|bun run scripts/check-non-negotiables.ts|baseline,verify|300
harness|./scripts/harness-check.sh|baseline,verify|300
build|bun run build|verify|900
e2e|bun run test:e2e|verify|900'

if [ "${1:-}" = "--check" ]; then
  # `brain verify list` prints TOON rows `name,stages,timeout,run` (stages
  # space-separated, a value quoted when TOON needs it). Normalise both sides to
  # `name|run|stages|timeout` and compare as sorted sets.
  DECLARED=$(brain verify list | node -e '
    const rows = require("fs").readFileSync(0, "utf8").split("\n");
    const start = rows.findIndex((r) => /^checks\[\d+\]/.test(r));
    if (start < 0) process.exit(0);
    for (const row of rows.slice(start + 1)) {
      if (!row.startsWith("  ")) break;
      const cells = [];
      let cell = "", quoted = false;
      for (const ch of row.slice(2)) {
        if (ch === "\"") quoted = !quoted;
        else if (ch === "," && !quoted) { cells.push(cell); cell = ""; }
        else cell += ch;
      }
      cells.push(cell);
      const [name, stages, timeout, ...run] = cells;
      console.log([name, run.join(","), stages.split(" ").join(","), timeout].join("|"));
    }
  ' | sort)
  WANT=$(printf '%s\n' "$GATES" | sort)
  if [ "$DECLARED" = "$WANT" ]; then
    echo "declared gates match scripts/brain-setup.sh"
    exit 0
  fi
  echo "declared gates differ from scripts/brain-setup.sh (run ./scripts/brain-setup.sh;"
  echo "a gate dropped from the list needs a fresh .brain/brain.db — brain verify has no remove):"
  diff <(printf '%s\n' "$WANT") <(printf '%s\n' "$DECLARED") | sed 's/^/  /' || true
  exit 1
fi

if [ ! -f .brain/brain.db ]; then
  brain init
fi

while IFS='|' read -r name run stages timeout; do
  [ -z "$name" ] && continue
  brain verify add "$name" --run "$run" --stages "$stages" --timeout "$timeout" --replace >/dev/null
done <<<"$GATES"

brain verify list
