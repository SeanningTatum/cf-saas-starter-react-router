#!/usr/bin/env bash
# Harness invariant checker. Deterministic. No LLM. Exit non-zero on any violation.
#
# Two layers:
#   1. Brain-state invariants: `brain check` (brain-axi 0.3.0) over .brain/brain.db —
#        SQLite integrity, foreign keys, search index, shipped ⇒ verified, plan/shot hashes —
#        then `brain-setup.sh --check` (the db's gates match the tracked list).
#        Uses the same CLI runner as brain-setup.sh (scripts/lib/brain-cli.sh). A missing
#        brain.db FAILS: a check that did not run must never render like one that passed.
#   2. Repo-specific supplement (below) — invariants brain-axi does not own:
#        B. init.sh exists and is executable
#        C. CLAUDE.md and AGENTS.md are the same file (symlink / byte-identical)
#        D. Every .claude/agents/*.md has YAML frontmatter with name + description
#        D2. .kimi-code/agents is a symlink onto .claude/agents (one roster, two CLIs)
#        G. Every hook script referenced by .claude/settings.json exists and is executable
#        H. The SessionStart skill restore passes its own tests
#        I. Workflows: every command that launches one has its script, every script
#           parses and names itself by filename, brand-init fences cover app/components/ui once

set -uo pipefail

cd "$(dirname "$0")/.."

FAIL=0
PASS_COUNT=0
FAIL_COUNT=0

ok()   { echo "  ✓ $1"; PASS_COUNT=$((PASS_COUNT+1)); }
fail() { echo "  ✗ $1"; FAIL_COUNT=$((FAIL_COUNT+1)); FAIL=1; }

# --- Layer 1: brain-axi CLI ---------------------------------------------------
echo "=== brain check (brain-axi CLI) ==="
echo ""

# shellcheck source=lib/brain-cli.sh
. scripts/lib/brain-cli.sh

if [ ! -f .brain/brain.db ]; then
  fail "no .brain/brain.db — brain state NOT checked (run ./scripts/brain-setup.sh)"
else
  if brain check; then
    ok "brain check passed"
  else
    fail "brain check reported violations (see output above)"
  fi
  if GATES_OUT=$(./scripts/brain-setup.sh --check 2>&1); then
    ok "$GATES_OUT"
  else
    fail "$GATES_OUT"
  fi
fi

echo ""
echo "=== repo-specific supplement ==="
echo ""

# B. init.sh executable
if [ -x init.sh ]; then
  ok "init.sh exists and is executable"
else
  fail "init.sh missing or not executable"
fi

# C. CLAUDE.md == AGENTS.md (symlink or byte-identical)
if cmp -s CLAUDE.md AGENTS.md 2>/dev/null; then
  ok "CLAUDE.md and AGENTS.md resolve to the same content"
else
  fail "CLAUDE.md and AGENTS.md differ — sync rule violated (re-create symlink: ln -sf AGENTS.md CLAUDE.md)"
fi

# D. Sub-agent frontmatter
AGENT_BAD=""
for f in .claude/agents/*.md; do
  base=$(basename "$f")
  [ "$base" = "README.md" ] && continue
  head -1 "$f" | grep -q '^---$' || AGENT_BAD="$AGENT_BAD $base"
  grep -q '^name:' "$f" || AGENT_BAD="$AGENT_BAD $base(no-name)"
  grep -q '^description:' "$f" || AGENT_BAD="$AGENT_BAD $base(no-desc)"
done
if [ -z "$AGENT_BAD" ]; then
  ok "all sub-agents have valid frontmatter"
else
  fail "sub-agents with broken frontmatter:$AGENT_BAD"
fi

# D2. Kimi Code reads the same roster. Kimi Code discovers project sub-agents from
#     .kimi-code/agents; that path is a symlink onto .claude/agents so one file
#     defines an agent for both CLIs. If the symlink is replaced by a real
#     directory the two rosters drift silently, which is the failure worth
#     catching — a copy looks fine right up until someone edits one side.
if [ -L .kimi-code/agents ]; then
  # Resolve both sides separately and require both to be non-empty. A dangling
  # symlink makes `cd` fail, and comparing two failed resolutions is `"" = ""` —
  # a false green over the exact state this check exists to catch.
  KIMI_AGENTS=$(cd .kimi-code/agents 2>/dev/null && pwd -P)
  CLAUDE_AGENTS=$(cd .claude/agents 2>/dev/null && pwd -P)
  if [ -z "$KIMI_AGENTS" ]; then
    fail ".kimi-code/agents is a dangling symlink — Kimi Code sees no project sub-agents (re-create: ln -sfn ../.claude/agents .kimi-code/agents)"
  elif [ -z "$CLAUDE_AGENTS" ]; then
    fail ".claude/agents is missing or unreadable — the shared sub-agent roster is gone"
  elif [ "$KIMI_AGENTS" = "$CLAUDE_AGENTS" ]; then
    ok "Kimi sub-agent roster symlinks onto .claude/agents"
  else
    fail ".kimi-code/agents points at $KIMI_AGENTS, not .claude/agents (re-create: ln -sfn ../.claude/agents .kimi-code/agents)"
  fi
elif [ -e .kimi-code/agents ]; then
  fail ".kimi-code/agents is a real path, not a symlink — rosters will drift (rm -rf it, then: ln -sfn ../.claude/agents .kimi-code/agents)"
else
  fail ".kimi-code/agents missing — Kimi Code sees no project sub-agents (mkdir -p .kimi-code && ln -sfn ../.claude/agents .kimi-code/agents)"
fi

# G. Hook scripts referenced by settings.json exist and are executable
HOOK_BAD=""
if [ -f .claude/settings.json ]; then
  while IFS= read -r h; do
    [ -z "$h" ] && continue
    [ -f "$h" ] || { HOOK_BAD="$HOOK_BAD $h(missing)"; continue; }
    [ -x "$h" ] || HOOK_BAD="$HOOK_BAD $h(not-executable)"
  done < <(jq -r '[.hooks // {} | .[][]? | .hooks[]? | .command // empty] | .[]' .claude/settings.json 2>/dev/null \
             | grep -oE '\.claude/hooks/[A-Za-z0-9_.-]+\.sh' | sort -u)
fi
if [ -z "$HOOK_BAD" ]; then
  ok "all settings.json hook scripts exist and are executable"
else
  fail "broken hook wiring:$HOOK_BAD"
fi

# H. Hook behaviour tests (SessionStart skill restore)
for t in test-restore-skills; do
  if [ -x "scripts/${t}.sh" ]; then
    if T_OUT=$("./scripts/${t}.sh" 2>&1); then
      ok "${t#test-} hook tests pass ($(grep -c '✓' <<<"$T_OUT") checks)"
    else
      fail "${t#test-} hook tests failed:"
      printf '%s\n' "$T_OUT" | sed 's/^/      /'
    fi
  else
    fail "scripts/${t}.sh missing or not executable"
  fi
done

# I. Workflows. A command that launches a workflow by name needs the script; each
#    script must parse and carry meta.name equal to its filename. Workflow scripts
#    are bodies, not modules: top-level `return`, undeclared globals. Wrap the body
#    in an async function so `node --check` sees valid ESM.
WF_BAD=""
WF_N=0
for c in .claude/commands/*.md; do
  while IFS= read -r wf; do
    [ -z "$wf" ] && continue
    [ -f ".claude/workflows/${wf}.js" ] || WF_BAD="$WF_BAD $(basename "$c"):${wf}.js(missing)"
  done < <(awk '/Workflow\(\{/ {w=1} w && match($0, /name: *"[^"]+"/) {s=substr($0,RSTART,RLENGTH); sub(/^name: *"/,"",s); sub(/"$/,"",s); print s; w=0}' "$c")
done
for f in .claude/workflows/*.js; do
  [ -f "$f" ] || continue
  WF_N=$((WF_N+1))
  base=$(basename "$f" .js)
  if ! { echo 'async function __workflow(){'; sed 's/^export const meta/const meta/' "$f"; echo; echo '}'; } | node --input-type=module --check >/dev/null 2>&1; then
    WF_BAD="$WF_BAD $base(syntax)"
  fi
  grep -Eq "^[[:space:]]*name:[[:space:]]*\"${base}\"" "$f" || WF_BAD="$WF_BAD $base(meta.name!=filename)"
done
if [ -z "$WF_BAD" ]; then
  ok "workflows intact ($WF_N scripts parse, meta.name matches, launched names resolve)"
else
  fail "broken workflows:$WF_BAD"
fi

# I2. brand-init hardcodes the primitive fences. Every file in app/components/ui must
#     appear exactly once as "<name>" in the script, or a primitive escapes the redesign
#     (0) or two lanes fight over it (2+).
if [ -f .claude/workflows/brand-init.js ]; then
  FENCE_BAD=""
  for u in app/components/ui/*.tsx; do
    n=$(basename "$u" .tsx)
    c=$(grep -o "\"${n}\"" .claude/workflows/brand-init.js | wc -l | tr -d ' ')
    [ "$c" = "1" ] || FENCE_BAD="$FENCE_BAD ${n}(x${c})"
  done
  if [ -z "$FENCE_BAD" ]; then
    ok "brand-init fences cover every app/components/ui primitive exactly once"
  else
    fail "brand-init fence mismatch:$FENCE_BAD"
  fi
fi

echo ""
echo "=== Summary ==="
echo "passed: $PASS_COUNT"
echo "failed: $FAIL_COUNT"
echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "Harness invariants intact (brain check + repo supplement)."
  exit 0
else
  echo "Harness has violations. Fix before declaring work done."
  exit 1
fi
