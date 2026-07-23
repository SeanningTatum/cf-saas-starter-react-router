#!/usr/bin/env bash
# Harness invariant checker. Deterministic. No LLM. Exit non-zero on any violation.
#
# Two layers:
#   1. `brain check` (brain-axi CLI) — the authoritative brain-state invariants:
#        feature_list parses, ≤1 in-progress, feature doc paths, dependency refs,
#        progress.md exists, plan meta.json, reviews.jsonl, verification Verdict lines.
#   2. Repo-specific supplement (below) — invariants brain-axi does not own:
#        A. .brain/HARNESS.md exists
#        B. init.sh exists and is executable
#        C. CLAUDE.md and AGENTS.md are the same file (symlink / byte-identical)
#        D. Every .claude/agents/*.md has YAML frontmatter with name + description
#        E. Core recipes (00-before-task, 99-verify-done) exist
#        F. Brain internal markdown links resolve
#
# brain-axi is the primary harness interface; this script layers the repo-only checks on top.

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

if command -v brain >/dev/null 2>&1; then
  BRAIN_CMD=(brain)
elif command -v npx >/dev/null 2>&1; then
  # brain-axi is not published to npm — resolve from GitHub.
  BRAIN_CMD=(npx -y github:SeanningTatum/brain-axi)
else
  BRAIN_CMD=()
fi

if [ ${#BRAIN_CMD[@]} -eq 0 ]; then
  fail "brain-axi CLI not found (install: npm i -g github:SeanningTatum/brain-axi, or npx skills add SeanningTatum/brain-axi --skill brain)"
else
  if "${BRAIN_CMD[@]}" check; then
    ok "brain check passed"
  else
    fail "brain check reported violations (see output above)"
  fi
fi

echo ""
echo "=== repo-specific supplement ==="
echo ""

# A. HARNESS.md exists
[ -f .brain/HARNESS.md ] && ok ".brain/HARNESS.md exists" || fail ".brain/HARNESS.md missing"

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

# E. Core recipes exist
MISSING_RECIPES=""
for r in 00-before-task 99-verify-done; do
  [ -f ".brain/recipes/${r}.md" ] || MISSING_RECIPES="$MISSING_RECIPES ${r}.md"
done
if [ -z "$MISSING_RECIPES" ]; then
  ok "core recipes (00-before-task, 99-verify-done) exist"
else
  fail "missing recipes:$MISSING_RECIPES"
fi

# F. Brain internal markdown links resolve (relative .md/.sh/.json/.ts paths only)
DEAD_LINKS=""
while IFS= read -r src; do
  while IFS= read -r target; do
    [ -z "$target" ] && continue
    clean=${target%%#*}
    [ -z "$clean" ] && continue
    src_dir=$(dirname "$src")
    abs="$src_dir/$clean"
    norm=$(cd "$src_dir" 2>/dev/null && cd "$(dirname "$clean")" 2>/dev/null && pwd)/$(basename "$clean")
    [ -e "$abs" ] || [ -e "$norm" ] || DEAD_LINKS="$DEAD_LINKS\n  $src → $clean"
  done < <(grep -oE '\]\([^)]+\.(md|sh|json|ts|tsx|jsonc)[^)]*\)' "$src" | sed -E 's/^\]\(([^)]+)\)$/\1/' | grep -vE '^https?://|^mailto:')
done < <(find .brain -name "*.md" -type f)

if [ -z "$DEAD_LINKS" ]; then
  ok "no dead internal links in .brain/"
else
  fail "dead internal links found:$(printf "$DEAD_LINKS")"
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
