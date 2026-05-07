#!/usr/bin/env bash
# Pre-commit reminder: surface .brain/ docs that likely need updating based on staged paths.
# Cheap, deterministic, no LLM call. Never blocks the commit.

set -uo pipefail

STAGED=$(git diff --cached --name-only 2>/dev/null || true)
[ -z "$STAGED" ] && exit 0

declare -A HINTS=(
  ["app/db/schema.ts"]=".brain/high-level-architecture/data-models.md + .brain/codebase/api.md"
  ["app/repositories/"]=".brain/rules/repository.md"
  ["app/services/"]=".brain/rules/services.md + .brain/high-level-architecture/integrations.md"
  ["app/trpc/routes/"]=".brain/rules/routes.md + .brain/codebase/api.md"
  ["app/models/errors/"]=".brain/rules/errors.md (also: tagToTRPC in app/lib/effect-trpc.ts)"
  ["app/auth/"]=".brain/high-level-architecture/security.md + .brain/features/authentication.md"
  ["wrangler.jsonc"]=".brain/rules/cloudflare.md + .brain/high-level-architecture/architecture.md"
  ["workflows/"]=".brain/rules/cloudflare.md"
  ["app/lib/"]=".brain/rules/library.md"
  ["app/components/"]=".brain/rules/frontend.md"
  ["app/routes/"]=".brain/rules/routes.md + .brain/rules/frontend.md"
  ["app/i18n/"]=".brain/codebase/i18n.md"
)

HITS=()
for path in "${!HINTS[@]}"; do
  if grep -q "^${path}" <<< "$STAGED"; then
    HITS+=("  • ${path} → ${HINTS[$path]}")
  fi
done

if [ ${#HITS[@]} -gt 0 ]; then
  echo ""
  echo "🧠 Brain-update reminder (commit not blocked):"
  printf '%s\n' "${HITS[@]}"
  echo ""
fi

exit 0
