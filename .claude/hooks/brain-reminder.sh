#!/usr/bin/env bash
# Pre-commit reminder: surface .brain/ docs that likely need updating based on staged paths.
# Cheap, deterministic, no LLM call. Never blocks the commit.
#
# Emits hookSpecificOutput.additionalContext — plain PreToolUse stdout only reaches the
# transcript, not the model, so the reminder has to be injected as context to be acted on.

set -uo pipefail

# jq builds the JSON envelope; without it the reminder is a no-op rather than malformed output.
command -v jq >/dev/null 2>&1 || exit 0

STAGED=$(git diff --cached --name-only 2>/dev/null || true)
[ -z "$STAGED" ] && exit 0

# prefix -> docs to update. A `case` table, not an associative array: macOS ships bash 3.2,
# where `declare -A` silently degrades to an indexed array and `set -u` then aborts the hook.
hint_for() {
  case "$1" in
    "app/db/schema.ts")   echo ".brain/high-level-architecture/data-models.md + .brain/codebase/api.md" ;;
    "app/repositories/")  echo ".brain/rules/repository.md" ;;
    "app/services/")      echo ".brain/rules/services.md + .brain/high-level-architecture/integrations.md" ;;
    "app/trpc/routes/")   echo ".brain/rules/routes.md + .brain/codebase/api.md" ;;
    "app/models/errors/") echo ".brain/rules/errors.md (also: tagToTRPC in app/lib/effect-trpc.ts)" ;;
    "app/auth/")          echo ".brain/high-level-architecture/security.md + .brain/features/authentication/authentication.md" ;;
    "wrangler.jsonc")     echo ".brain/rules/cloudflare.md + .brain/high-level-architecture/architecture.md" ;;
    "workflows/")         echo ".brain/rules/cloudflare.md" ;;
    "app/lib/")           echo ".brain/rules/library.md" ;;
    "app/components/")    echo ".brain/rules/frontend.md" ;;
    "app/routes/")        echo ".brain/rules/routes.md + .brain/rules/frontend.md" ;;
    "app/i18n/")          echo ".brain/codebase/i18n.md" ;;
  esac
}

HITS=()
for path in \
  "app/db/schema.ts" "app/repositories/" "app/services/" "app/trpc/routes/" \
  "app/models/errors/" "app/auth/" "wrangler.jsonc" "workflows/" \
  "app/lib/" "app/components/" "app/routes/" "app/i18n/"
do
  # Escape dots: unescaped, `app/db/schema.ts` is a BRE where `.` is a wildcard, so a staged
  # `app/db/schema_ts` would spuriously match.
  pattern=${path//./\\.}
  if grep -q "^${pattern}" <<< "$STAGED"; then
    HITS+=("  • ${path} → $(hint_for "$path")")
  fi
done

if [ ${#HITS[@]} -gt 0 ]; then
  CONTEXT="🧠 Brain-update reminder (commit not blocked) — staged paths whose .brain/ docs likely need updating:
$(printf '%s\n' "${HITS[@]}")"
  jq -n --arg ctx "$CONTEXT" '{
    suppressOutput: true,
    hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: $ctx }
  }'
fi

exit 0
