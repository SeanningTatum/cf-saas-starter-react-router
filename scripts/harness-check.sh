#!/usr/bin/env bash
# Harness invariant checker. Deterministic. No LLM. Exit non-zero on any violation.
#
# Checks:
#        B. init.sh exists and is executable
#        C. CLAUDE.md and AGENTS.md are the same file (symlink / byte-identical)
#        D. Every .claude/agents/*.md has YAML frontmatter with name + description
#        D1. Agent frontmatter is valid (name = file name, tools, model, effort) and the README roster table is fresh (bun scripts/roster.ts check)
#        D2. .kimi-code/agents is a symlink onto .claude/agents (one roster, two CLIs)
#        G. Every hook script referenced by .claude/settings.json exists and is executable
#        H. The SessionStart skill restore and the context-memory store resolver pass their own tests
#        I. Workflows: every command that launches one has its script, every script
#           parses and names itself by filename, brand-init's primitive lanes (harness.config.json) cover the primitives folder once
#        J. The workflow scripts are what their sources build (.claude/workflow-src + the shared library)
#        K. The repo's ruleset and production environment match .github/repo-rules.json
#        L. The rule table in docs/agents/lint-rules.md is what scripts/lint/rules generates
#        M. harness.config.json is valid (bun scripts/harness-config.ts check)
#        N. Harness code holds no literal path under the app folder (the grep gate)

set -uo pipefail

cd "$(dirname "$0")/.."

# The gate reads the checkout it sits in, never a repo its caller's environment names. Inside
# a git hook, GIT_DIR and GIT_INDEX_FILE point at the repo being committed to, and the script
# tests under H run `git init`, `git commit` and `git worktree add` in throwaway repos: with
# those variables set, git would do all three to the real repo (an inherited GIT_DIR once set
# core.bare in the shared config and broke every worktree). So drop git's repo variables.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_OBJECT_DIRECTORY \
  GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_NAMESPACE GIT_PREFIX GIT_CEILING_DIRECTORIES \
  GIT_CONFIG GIT_CONFIG_PARAMETERS GIT_CONFIG_COUNT GIT_GRAFT_FILE GIT_SHALLOW_FILE \
  GIT_IMPLICIT_WORK_TREE GIT_REPLACE_REF_BASE GIT_NO_REPLACE_OBJECTS

FAIL=0
PASS_COUNT=0
FAIL_COUNT=0

ok()   { echo "  ✓ $1"; PASS_COUNT=$((PASS_COUNT+1)); }
fail() { echo "  ✗ $1"; FAIL_COUNT=$((FAIL_COUNT+1)); FAIL=1; }

echo "=== harness invariants ==="
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

# D1. Roster: every agent's name, tools, model and effort are valid, and the table in
#     .claude/agents/README.md is what the frontmatter produces. The script prints the fix.
if ROSTER_OUT=$(bun scripts/roster.ts check 2>&1); then
  ok "$ROSTER_OUT"
else
  fail "agent roster invalid or stale:"
  printf '%s\n' "$ROSTER_OUT" | sed 's/^/      /'
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

# H. Script behaviour tests (SessionStart skill restore, context-memory store resolver, CodeGraph wrapper)
for t in test-restore-skills test-memory-dir test-codegraph; do
  if [ -x "scripts/${t}.sh" ]; then
    if T_OUT=$("./scripts/${t}.sh" 2>&1); then
      ok "${t#test-} tests pass ($(grep -c '✓' <<<"$T_OUT") checks)"
    else
      fail "${t#test-} tests failed:"
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
  # A bare agentType must be a built-in or a project agent; plugin agents carry a "plugin:" prefix.
  while IFS= read -r at; do
    [ -z "$at" ] && continue
    case "$at" in *:*|Explore|Plan|general-purpose) continue ;; esac
    [ -f ".claude/agents/${at}.md" ] || WF_BAD="$WF_BAD $base(agentType ${at} has no .claude/agents/${at}.md)"
  done < <(grep -oE "agentType:[^,}]*" "$f" | grep -oE "[\"'][A-Za-z0-9:_-]+[\"']" | tr -d "\"'" | sort -u)
done
if [ -z "$WF_BAD" ]; then
  ok "workflows intact ($WF_N scripts parse, meta.name matches, launched names and agentTypes resolve)"
else
  fail "broken workflows:$WF_BAD"
fi

# I2. brand-init's primitive lanes live in harness.config.json (brandInit.primitiveLanes). Every
#     file in the primitives folder (paths.primitives) must appear exactly once in a lane (0 = a
#     primitive escapes the redesign, 2+ = two lanes fight over it), and every lane file must exist.
#     A project whose config has no primitive lanes has nothing to check.
if LANES_JSON=$(bun scripts/harness-config.ts get brandInit.primitiveLanes 2>/dev/null) && [ -n "$LANES_JSON" ] && PRIM_DIR=$(bun scripts/harness-config.ts get paths.primitives 2>/dev/null) && [ -d "$PRIM_DIR" ]; then
  LANE_FILES=$(printf '%s\n' "$LANES_JSON" | grep -oE '"files":\[[^]]*\]' | grep -oE '"[A-Za-z0-9._-]+"' | grep -vx '"files"' | tr -d '"')
  FENCE_BAD=""
  for u in "$PRIM_DIR"/*.tsx; do
    n=$(basename "$u" .tsx)
    c=$(printf '%s\n' "$LANE_FILES" | grep -cx "$n")
    [ "$c" = "1" ] || FENCE_BAD="$FENCE_BAD ${n}(x${c})"
  done
  # The reverse: a lane must not name a primitive that is gone, or it is told to edit a missing file.
  while IFS= read -r n; do
    [ -z "$n" ] && continue
    [ -f "$PRIM_DIR/${n}.tsx" ] || FENCE_BAD="$FENCE_BAD ${n}(no-file)"
  done < <(printf '%s\n' "$LANE_FILES" | sort -u)
  if [ -z "$FENCE_BAD" ]; then
    ok "brand-init fences cover every $PRIM_DIR primitive exactly once and name no missing one"
  else
    fail "brand-init fence mismatch:$FENCE_BAD"
  fi
fi

# J. .claude/workflows/*.js are built: each is its source in .claude/workflow-src/ with the shared
#    library pasted in. A script edited by hand, or a source edited without a rebuild, drifts.
if WF_OUT=$(bun scripts/workflows.ts check 2>&1); then
  ok "$WF_OUT"
else
  fail "workflow scripts differ from their sources:"
  printf '%s\n' "$WF_OUT" | sed 's/^/      /'
fi

# K. Repo rules. The ruleset on the default branch and the production environment must
#    match .github/repo-rules.json (docs/ci/repo-rules.md says when a notice stays green).
RR_OUT=$(bun run scripts/repo-rules.ts --check 2>&1)
RR_CODE=$?
if [ "$RR_CODE" -ne 0 ]; then
  fail "repo rules differ from .github/repo-rules.json:"
  printf '%s\n' "$RR_OUT" | sed 's/^/      /'
elif grep -q '^notice:' <<<"$RR_OUT"; then
  grep '^notice:' <<<"$RR_OUT" | sed 's/^notice:/  - repo rules:/'
  # In GitHub Actions the script also prints `::notice::` lines; pass them through
  # at the start of a line so the run page shows them.
  grep '^::notice::' <<<"$RR_OUT" || true
else
  ok "repo rules match .github/repo-rules.json"
fi

# L. The house lint rules page. Its table is generated from scripts/lint/rules; a rule added
#    or reworded without a rewrite leaves the page stale. The script prints the fix.
if LINT_DOCS_OUT=$(bun scripts/lint/cli.ts --check-docs 2>&1); then
  ok "$LINT_DOCS_OUT"
else
  fail "lint rules page is stale:"
  printf '%s\n' "$LINT_DOCS_OUT" | sed 's/^/      /'
fi

# M. harness.config.json. The one file of project values the harness reads (docs/agents/harness-config.md):
#    a typo in a key or a wrong type fails here, not in the middle of a workflow.
HC_OUT=$(bun scripts/harness-config.ts check 2>&1)
HC_CODE=$?
if [ "$HC_CODE" -ne 0 ]; then
  fail "harness.config.json is invalid:"
  printf '%s\n' "$HC_OUT" | sed 's/^/      /'
else
  ok "$HC_OUT"
fi

# N. The grep gate. Harness code holds no literal path under the app folder: project paths live in
#    harness.config.json. Scope: the workflow sources and built scripts, the harness scripts and their
#    libraries. Not in scope: harness.config.json itself, tests and fixtures, the agent briefs in
#    .claude/agents/ (prose), and the app's own scripts (seeding, first-time setup, teardown, CI
#    helpers, the linters), which the ADR leaves in the project. The pattern is the folder name not
#    preceded by a letter, digit, _, -, . or /, so a webapp folder and node_modules/<name> do not match;
#    it is written as a repeat so this file does not hold the literal either.
N_PATTERN='(^|[^A-Za-z0-9_./-])ap{2}/'
N_CANDIDATES=(.claude/workflow-src/*.js .claude/workflows/*.js scripts/verify.sh scripts/harness-check.sh scripts/tracker.ts scripts/stack.ts
  scripts/pr-review-wait.ts scripts/design-audit.ts scripts/workflows.ts scripts/memory.ts scripts/run-telemetry.ts scripts/harness-config.ts
  scripts/lib/gh.ts scripts/lib/workflow-dry-run.ts scripts/lib/run-telemetry*.ts scripts/lib/harness-config*.ts scripts/lib/audit-login.ts)
N_FILES=()
for f in "${N_CANDIDATES[@]}"; do [ -f "$f" ] && N_FILES+=("$f"); done
N_HITS=$(grep -HnE "$N_PATTERN" "${N_FILES[@]}" 2>/dev/null)
if [ -n "$N_HITS" ]; then
  fail "harness code holds a literal path under the app folder; read it from harness.config.json:"
  printf '%s\n' "$N_HITS" | cut -c1-160 | sed 's/^/      /'
else
  ok "harness code holds no literal path under the app folder (${#N_FILES[@]} files checked)"
fi
# end N

echo ""
echo "=== Summary ==="
echo "passed: $PASS_COUNT"
echo "failed: $FAIL_COUNT"
echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "Harness invariants intact."
  exit 0
else
  echo "Harness has violations. Fix before declaring work done."
  exit 1
fi
