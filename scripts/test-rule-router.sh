#!/usr/bin/env bash
# Tests for .claude/hooks/rule-router.sh — the path -> .brain/rules layer mapping.
# Deterministic, offline, no LLM. Run standalone or via scripts/harness-check.sh.
#
# Each case gets a fresh TMPDIR so the hook's once-per-session dedupe is controlled.

set -uo pipefail

cd "$(dirname "$0")/.."
REPO=$PWD
HOOK=.claude/hooks/rule-router.sh

PASS=0
FAILED=0

ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ✗ $1"; FAILED=$((FAILED+1)); }

# payload <file_path> [session] [extra_json_for_tool_input]
payload() {
  jq -nc \
    --arg f "$1" \
    --arg s "${2:-sess-1}" \
    --arg cwd "$REPO" \
    --arg extra "${3:-}" \
    '{
      session_id: $s,
      cwd: $cwd,
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: ({ file_path: $f } + (if $extra == "" then {} else { old_string: $extra } end))
    }'
}

# run <file_path> [session] [extra] -> hook stdout
run() {
  local tmp
  tmp=$(mktemp -d)
  payload "$1" "${2:-sess-1}" "${3:-}" | TMPDIR="$tmp" bash "$HOOK"
  rm -rf "$tmp"
}

ctx() { jq -r '.hookSpecificOutput.additionalContext // ""' 2>/dev/null; }

# --- 1. each layer maps to its rule ------------------------------------------
declare -a CASES=(
  "app/services/billing.ts|services"
  "app/auth/server.ts|services"
  "app/repositories/user.ts|repository"
  "app/db/schema.ts|repository"
  "app/components/ui/button.tsx|frontend"
  "app/app.css|frontend"
  "app/trpc/routes/user.ts|routes"
  "wrangler.jsonc|cloudflare"
  "workers/app.ts|cloudflare"
  "workflows/import.ts|cloudflare"
  "worker-configuration.d.ts|cloudflare"
  "app/models/errors/user.ts|errors"
  "e2e/smoke.spec.ts|library"
)
for c in "${CASES[@]}"; do
  path=${c%%|*}; want=${c##*|}
  got=$(run "$path" | ctx)
  if grep -q "\.brain/rules/${want}\.md" <<<"$got"; then
    ok "$path → rules/${want}.md"
  else
    bad "$path → expected rules/${want}.md, got: ${got:-<empty>}"
  fi
done

# --- 2. multi-layer files emit every matching rule ---------------------------
got=$(run "app/routes/dashboard/settings.tsx" | ctx)
if grep -q "rules/frontend.md" <<<"$got" && grep -q "rules/routes.md" <<<"$got"; then
  ok "app/routes/**/*.tsx → frontend.md + routes.md"
else
  bad "nested .tsx route should hit frontend + routes, got: ${got:-<empty>}"
fi

got=$(run "app/lib/effect-trpc.ts" | ctx)
if grep -q "rules/library.md" <<<"$got" && grep -q "rules/errors.md" <<<"$got"; then
  ok "app/lib/effect-trpc.ts → library.md + errors.md"
else
  bad "effect-trpc.ts should hit library + errors, got: ${got:-<empty>}"
fi

# --- 3. absolute paths are relativized --------------------------------------
got=$(run "$REPO/app/services/billing.ts" | ctx)
if grep -q "rules/services.md" <<<"$got"; then
  ok "absolute file_path relativized against cwd"
else
  bad "absolute path not relativized, got: ${got:-<empty>}"
fi

# --- 4. unmatched paths stay silent -----------------------------------------
for p in "README.md" ".brain/rules/services.md" "app/models/user.ts" "package.json"; do
  got=$(run "$p")
  [ -z "$got" ] && ok "no output for $p" || bad "expected silence for $p, got: $got"
done

# --- 5. once per rule per session -------------------------------------------
tmp=$(mktemp -d)
first=$(payload "app/services/a.ts" sess-dedupe | TMPDIR="$tmp" bash "$HOOK")
second=$(payload "app/services/b.ts" sess-dedupe | TMPDIR="$tmp" bash "$HOOK")
third=$(payload "app/repositories/a.ts" sess-dedupe | TMPDIR="$tmp" bash "$HOOK")
rm -rf "$tmp"
[ -n "$first" ] && ok "first edit in a layer emits" || bad "first edit emitted nothing"
[ -z "$second" ] && ok "second edit in same layer is silent (dedupe)" || bad "dedupe failed: $second"
grep -q "rules/repository.md" <<<"$(ctx <<<"$third")" \
  && ok "a different layer still emits in the same session" \
  || bad "second layer suppressed: ${third:-<empty>}"

# --- 6. different sessions are independent ----------------------------------
tmp=$(mktemp -d)
payload "app/services/a.ts" sess-A | TMPDIR="$tmp" bash "$HOOK" >/dev/null
other=$(payload "app/services/a.ts" sess-B | TMPDIR="$tmp" bash "$HOOK")
rm -rf "$tmp"
[ -n "$other" ] && ok "a new session re-emits" || bad "session isolation failed"

# --- 7. hostile tool_input does not break parsing ---------------------------
NASTY='{"file_path": "/etc/passwd"} `rm -rf /` "quoted" $(whoami)
newline'
got=$(run "app/services/billing.ts" sess-nasty "$NASTY" | ctx)
if grep -q "rules/services.md" <<<"$got"; then
  ok "quotes/newlines/shell metachars in old_string are inert"
else
  bad "hostile old_string broke the hook, got: ${got:-<empty>}"
fi

# --- 8. output contract -----------------------------------------------------
raw=$(run "app/services/billing.ts" sess-contract)
if jq -e '.hookSpecificOutput.hookEventName == "PreToolUse"
          and (.hookSpecificOutput.additionalContext | type == "string")
          and .suppressOutput == true' >/dev/null 2>&1 <<<"$raw"; then
  ok "emits valid PreToolUse hookSpecificOutput JSON"
else
  bad "output contract broken: $raw"
fi

# --- 9. degrades safely -----------------------------------------------------
got=$(jq -nc '{session_id:"s", tool_name:"Edit", tool_input:{}}' | bash "$HOOK")
[ -z "$got" ] && ok "missing file_path → no output" || bad "expected silence, got: $got"

got=$(printf '' | bash "$HOOK")
[ -z "$got" ] && ok "empty stdin → no output" || bad "expected silence, got: $got"

got=$(printf 'not json' | bash "$HOOK" 2>/dev/null)
[ -z "$got" ] && ok "non-JSON stdin → no output" || bad "expected silence, got: $got"

# --- 10. glob table matches .brain/rules/index.md ----------------------------
MISSING=""
for r in frontend cloudflare repository services routes library errors; do
  grep -q "add ${r} ;;" "$HOOK" || MISSING="$MISSING $r"
  [ -f ".brain/rules/${r}.md" ] || MISSING="$MISSING ${r}(no-doc)"
done
[ -z "$MISSING" ] && ok "all 7 layer rules are routed and exist" || bad "unrouted/missing rules:$MISSING"

echo ""
echo "rule-router: passed $PASS, failed $FAILED"
[ "$FAILED" -eq 0 ] && exit 0 || exit 1
