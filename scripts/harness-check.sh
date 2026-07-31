#!/usr/bin/env bash
# Harness invariant checker. Deterministic. No LLM. Exit non-zero on any violation.
#
# Two layers:
#   1. Brain-state invariants. If the brain-axi CLI (`brain`) is on PATH, run the authoritative
#        `brain check` (feature_list parses, ≤1 in-progress, feature doc paths, dependency refs,
#        progress.md exists, plan meta.json, reviews.jsonl, verification Verdict lines).
#        If not, fall back to the core invariants inline with jq — NO network dependency, so
#        offline dev still works (install brain-axi for the full check).
#   2. Repo-specific supplement (below) — invariants brain-axi does not own:
#        A. .brain/HARNESS.md exists
#        B. init.sh exists and is executable
#        C. CLAUDE.md and AGENTS.md are the same file (symlink / byte-identical)
#        D. Every .claude/agents/*.md has YAML frontmatter with name + description
#        E. Core recipes (00-before-task, 99-verify-done) exist
#        F. Brain internal markdown links resolve
#        G. Every hook script referenced by .claude/settings.json exists and is executable
#        H. The rule-router path->rules mapping passes its own tests
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

FL=.brain/features/feature_list.json

if command -v brain >/dev/null 2>&1; then
  # brain-axi on PATH: authoritative, no network dependency.
  if brain check; then
    ok "brain check passed"
  else
    fail "brain check reported violations (see output above)"
  fi

  # STRICT IS A GATE, via a ratchet.
  #
  # `--strict` additionally requires every shipped feature to carry a PASS
  # verification bound to a commit. Five features here shipped before that
  # invariant existed and have no browser-walk evidence, so this started as an
  # advisory — but an advisory decays into noise, and review rightly called that
  # a dodge.
  #
  # The ratchet resolves it without fabricating anything: `policy.strict_grandfathered`
  # in feature_list.json lists exactly those legacy slugs, committed and
  # reviewable. Every NEW ship must satisfy the gate. The list only shrinks —
  # `brain check --strict` fails if an entry becomes fully provable and was left
  # on it. Close the debt by actually verifying those flows (`brain playbook
  # verify` -> feature-verifier browser walk -> `brain receipt <slug>`), then
  # delete the entry.
  if brain check --strict; then
    ok "brain check --strict passed (new ships must prove themselves; legacy debt is on the ratchet list)"
  else
    fail "brain check --strict reported violations (see output above)"
  fi
else
  # No brain-axi on PATH.
  #
  # This used to run a reduced jq subset, count every inline check as a PASS, and
  # exit 0 with the same "Harness invariants intact" summary as a full run — so a
  # machine missing the CLI reported an intact harness while skipping the schema,
  # verdict, drift, plan-integrity, and eval invariants entirely. Silence looked
  # identical to success, which is the one thing a gate must never do.
  #
  # The inline checks still run (they are genuinely useful offline), but this is
  # now an explicit DEGRADED mode that fails. Anything that must pass without the
  # CLI should install it:
  #   npm i -g github:SeanningTatum/brain-axi
  #   # or, no install:  npx -y github:SeanningTatum/brain-axi check
  DEGRADED=1
  echo "  ✗ brain CLI not on PATH — DEGRADED mode."
  echo "    Running the inline jq subset below, but this run cannot verify the"
  echo "    schema, verdict, index-drift, plan-integrity, or eval invariants."
  echo "    Install brain-axi (npm i -g github:SeanningTatum/brain-axi) — a reduced"
  echo "    check set must not report an intact harness."
  echo ""
  FAIL=1
  FAIL_COUNT=$((FAIL_COUNT+1))

  # 1. feature_list.json parses
  if jq empty "$FL" 2>/dev/null; then
    ok "feature_list.json parses"
  else
    fail "feature_list.json does NOT parse as JSON"
  fi

  # 2. ≤1 in-progress
  IN_PROGRESS=$(jq '[.features[] | select(.status=="in-progress")] | length' "$FL" 2>/dev/null || echo "ERR")
  if [ "$IN_PROGRESS" = "ERR" ]; then
    fail "could not count in-progress features"
  elif [ "$IN_PROGRESS" -le 1 ]; then
    ok "in-progress feature count = $IN_PROGRESS (max 1)"
  else
    IP_LIST=$(jq -r '.features[] | select(.status=="in-progress") | .id' "$FL" | tr '\n' ' ')
    fail "in-progress count = $IN_PROGRESS — violates one-at-a-time policy. Conflicts: $IP_LIST"
  fi

  # 3. Every feature.doc resolves
  MISSING_DOCS=$(jq -r '.features[] | select(.doc != null) | .doc' "$FL" | while read -r d; do
    [ -f "$d" ] || echo "$d"
  done)
  if [ -z "$MISSING_DOCS" ]; then
    ok "every feature doc path resolves"
  else
    fail "missing feature docs: $(echo $MISSING_DOCS | tr '\n' ' ')"
  fi

  # 4. Dependencies reference real feat-ids
  ALL_IDS=$(jq -r '.features[].id' "$FL" | sort -u)
  DANGLING=""
  while IFS= read -r dep; do
    echo "$ALL_IDS" | grep -qx "$dep" || DANGLING="$DANGLING $dep"
  done < <(jq -r '.features[].dependencies[]?' "$FL" | sort -u)
  if [ -z "$DANGLING" ]; then
    ok "all dependencies reference real feat-ids"
  else
    fail "dangling dependency refs:$DANGLING"
  fi

  # 5. progress.md exists
  [ -f .brain/runs/progress.md ] && ok ".brain/runs/progress.md exists" || fail ".brain/runs/progress.md missing"
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
  fail "dead internal links found:$(printf '%s' "$DEAD_LINKS")"
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

# H. Hook behaviour tests (path -> docs mappings)
for t in test-rule-router test-brain-reminder; do
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
