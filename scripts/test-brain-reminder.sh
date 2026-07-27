#!/usr/bin/env bash
# Tests for .claude/hooks/brain-reminder.sh — the staged-path -> .brain/ docs reminder.
# Deterministic, offline, no LLM. Run standalone or via scripts/harness-check.sh.
#
# The hook reads `git diff --cached`, so each case runs inside a throwaway git repo.

set -uo pipefail

cd "$(dirname "$0")/.."
HOOK=$PWD/.claude/hooks/brain-reminder.sh

PASS=0
FAILED=0
ok()  { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad() { echo "  ✗ $1"; FAILED=$((FAILED+1)); }

# run <staged_path...> -> hook stdout, from a fresh repo with those paths staged
run() {
  local tmp out
  tmp=$(mktemp -d)
  (
    cd "$tmp" || exit 1
    git init -q . 2>/dev/null
    for p in "$@"; do
      mkdir -p "$(dirname "$p")"
      printf 'x\n' >"$p"
      git add "$p" 2>/dev/null
    done
    bash "$HOOK"
  )
  out=$?
  rm -rf "$tmp"
  return $out
}

ctx() { jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null; }

# --- 1. each staged prefix surfaces its docs ---------------------------------
declare -a CASES=(
  "app/db/schema.ts|data-models.md"
  "app/repositories/user.ts|rules/repository.md"
  "app/services/billing.ts|rules/services.md"
  "app/trpc/routes/user.ts|rules/routes.md"
  "app/models/errors/user.ts|rules/errors.md"
  "app/auth/server.ts|security.md"
  "wrangler.jsonc|rules/cloudflare.md"
  "workflows/import.ts|rules/cloudflare.md"
  "app/lib/utils.ts|rules/library.md"
  "app/components/card.tsx|rules/frontend.md"
  "app/routes/home.tsx|rules/frontend.md"
  "app/i18n/en.ts|codebase/i18n.md"
)
for c in "${CASES[@]}"; do
  path=${c%%|*}; want=${c##*|}
  got=$(run "$path" | ctx)
  if grep -q "$want" <<<"$got"; then
    ok "staged $path → $want"
  else
    bad "staged $path → expected $want, got: ${got:-<empty>}"
  fi
done

# --- 2. no bash-3.2 associative-array regression ----------------------------
# `declare -A` degrades to an indexed array on macOS bash 3.2; with `set -u` the hook then
# died with "app: unbound variable" and emitted nothing. Guard the fix.
err=$(run "app/lib/utils.ts" 2>&1 >/dev/null)
if [ -z "$err" ]; then
  ok "no stderr noise (bash 3.2 safe — no declare -A)"
else
  bad "hook wrote to stderr: $err"
fi
# Comment lines mention it deliberately; only executable lines are a regression.
if grep -vE '^[[:space:]]*#' "$HOOK" | grep -q 'declare -A'; then
  bad "declare -A reintroduced (breaks on bash 3.2)"
else
  ok "hook avoids declare -A"
fi

# --- 3. multiple staged prefixes all reported -------------------------------
got=$(run "app/services/a.ts" "app/components/b.tsx" | ctx)
if grep -q "rules/services.md" <<<"$got" && grep -q "rules/frontend.md" <<<"$got"; then
  ok "multiple staged layers all reported"
else
  bad "expected services + frontend, got: ${got:-<empty>}"
fi

# --- 4. silence when nothing relevant is staged -----------------------------
got=$(run "README.md")
[ -z "$got" ] && ok "no output for unmapped staged path" || bad "expected silence, got: $got"

got=$(run)
[ -z "$got" ] && ok "no output when nothing is staged" || bad "expected silence, got: $got"

# --- 5. output contract -----------------------------------------------------
raw=$(run "app/lib/utils.ts")
if jq -e '.hookSpecificOutput.hookEventName == "PreToolUse"
          and (.hookSpecificOutput.additionalContext | type == "string")' >/dev/null 2>&1 <<<"$raw"; then
  ok "emits valid PreToolUse hookSpecificOutput JSON"
else
  bad "output contract broken: $raw"
fi

echo ""
echo "brain-reminder: passed $PASS, failed $FAILED"
[ "$FAILED" -eq 0 ] && exit 0 || exit 1
