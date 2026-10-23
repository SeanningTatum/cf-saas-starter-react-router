#!/usr/bin/env bash
# Create this checkout's brain and declare the repo's gates in it. Idempotent.
#
# brain-axi 0.3.0 keeps the brain in one gitignored SQLite file, .brain/brain.db,
# so nothing about it arrives with a clone — including the checks `brain verify`
# runs. This script is the tracked source for those checks: init.sh, CI and
# first-time setup all call it, so every checkout declares the same gates.
#
# Uses `brain` when it is on PATH, else the pinned CLI through npx.

set -euo pipefail

cd "$(dirname "$0")/.."

BRAIN_AXI_SPEC="github:SeanningTatum/brain-axi#v0.3.0"

if command -v brain >/dev/null 2>&1; then
  brain() { command brain "$@"; }
else
  brain() { npx -y "$BRAIN_AXI_SPEC" "$@"; }
fi

if [ ! -f .brain/brain.db ]; then
  brain init
fi

# name | command | stages | timeout (s)
while IFS='|' read -r name run stages timeout; do
  [ -z "$name" ] && continue
  brain verify add "$name" --run "$run" --stages "$stages" --timeout "$timeout" --replace >/dev/null
done <<'EOF'
typecheck|bun run typecheck|bootstrap,baseline,verify|600
test|bun run test|bootstrap,baseline,verify|600
non-negotiables-selftest|bun run scripts/check-non-negotiables.ts --selftest|baseline,verify|300
non-negotiables|bun run scripts/check-non-negotiables.ts|baseline,verify|300
harness|./scripts/harness-check.sh|baseline,verify|300
build|bun run build|verify|900
e2e|bun run test:e2e|verify|900
EOF

brain verify list
