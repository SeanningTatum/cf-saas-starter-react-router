#!/usr/bin/env bash
# Harness invariant checker. Deterministic. No LLM. Exit non-zero on any violation.
#
# Checks:
#   1. .brain/features/feature_list.json parses as JSON
#   2. At most one feature has status: "in-progress"
#   3. Every feature.doc path exists on disk
#   4. Every feature.dependencies entry references a real feat-id
#   5. .brain/HARNESS.md exists
#   6. .brain/runs/progress.md exists
#   7. init.sh exists and is executable
#   8. CLAUDE.md and AGENTS.md are byte-identical
#   9. Every .claude/agents/*.md has YAML frontmatter with name + description
#  10. Every recipe referenced in CLAUDE.md exists

set -uo pipefail

cd "$(dirname "$0")/.."

FAIL=0
PASS_COUNT=0
FAIL_COUNT=0

ok()   { echo "  ✓ $1"; PASS_COUNT=$((PASS_COUNT+1)); }
fail() { echo "  ✗ $1"; FAIL_COUNT=$((FAIL_COUNT+1)); FAIL=1; }

echo "=== Harness invariant check ==="
echo ""

# 1. feature_list.json parses
if jq empty .brain/features/feature_list.json 2>/dev/null; then
  ok "feature_list.json parses"
else
  fail "feature_list.json does NOT parse as JSON"
fi

# 2. ≤1 in-progress
IN_PROGRESS=$(jq '[.features[] | select(.status=="in-progress")] | length' .brain/features/feature_list.json 2>/dev/null || echo "ERR")
if [ "$IN_PROGRESS" = "ERR" ]; then
  fail "could not count in-progress features"
elif [ "$IN_PROGRESS" -le 1 ]; then
  ok "in-progress feature count = $IN_PROGRESS (max 1)"
else
  IP_LIST=$(jq -r '.features[] | select(.status=="in-progress") | .id' .brain/features/feature_list.json | tr '\n' ' ')
  fail "in-progress count = $IN_PROGRESS — violates one-at-a-time policy. Conflicts: $IP_LIST"
fi

# 3. Every feature.doc exists
MISSING_DOCS=$(jq -r '.features[] | select(.doc != null) | .doc' .brain/features/feature_list.json | while read -r d; do
  [ -f "$d" ] || echo "$d"
done)
if [ -z "$MISSING_DOCS" ]; then
  ok "every feature doc path resolves"
else
  fail "missing feature docs: $(echo $MISSING_DOCS | tr '\n' ' ')"
fi

# 4. Dependencies reference real feat-ids
ALL_IDS=$(jq -r '.features[].id' .brain/features/feature_list.json | sort -u)
DANGLING=""
while IFS= read -r dep; do
  if ! echo "$ALL_IDS" | grep -qx "$dep"; then
    DANGLING="$DANGLING $dep"
  fi
done < <(jq -r '.features[].dependencies[]?' .brain/features/feature_list.json | sort -u)
if [ -z "$DANGLING" ]; then
  ok "all dependencies reference real feat-ids"
else
  fail "dangling dependency refs:$DANGLING"
fi

# 5. HARNESS.md exists
[ -f .brain/HARNESS.md ] && ok ".brain/HARNESS.md exists" || fail ".brain/HARNESS.md missing"

# 6. progress.md exists
[ -f .brain/runs/progress.md ] && ok ".brain/runs/progress.md exists" || fail ".brain/runs/progress.md missing"

# 7. init.sh executable
if [ -x init.sh ]; then
  ok "init.sh exists and is executable"
else
  fail "init.sh missing or not executable"
fi

# 8. CLAUDE.md == AGENTS.md
if cmp -s CLAUDE.md AGENTS.md 2>/dev/null; then
  ok "CLAUDE.md and AGENTS.md are byte-identical"
else
  fail "CLAUDE.md and AGENTS.md differ — sync rule violated"
fi

# 9. Sub-agent frontmatter
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

# 10. Recipes referenced in CLAUDE.md exist
MISSING_RECIPES=""
for r in 00-before-task 99-verify-done; do
  [ -f ".brain/recipes/${r}.md" ] || MISSING_RECIPES="$MISSING_RECIPES ${r}.md"
done
if [ -z "$MISSING_RECIPES" ]; then
  ok "core recipes (00-before-task, 99-verify-done) exist"
else
  fail "missing recipes:$MISSING_RECIPES"
fi

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
