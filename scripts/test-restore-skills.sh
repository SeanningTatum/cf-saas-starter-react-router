#!/usr/bin/env bash
# Tests for scripts/restore-skills.sh — lock ownership, stale-lock reclaim, and one-installer
# concurrency. Deterministic, offline: each case runs a copy of the script in a sandbox with
# stub bunx/npx that "install" by writing SKILL.md files and logging the call.
# Run standalone or via scripts/harness-check.sh.

set -uo pipefail

cd "$(dirname "$0")/.."
SCRIPT=$PWD/scripts/restore-skills.sh

PASS=0
FAILED=0

ok()  { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad() { echo "  ✗ $1"; FAILED=$((FAILED+1)); }

started() { ps -o lstart= -p "$1" 2>/dev/null | awk '{$1=$1; print}'; }

# sandbox -> path of a fresh repo-shaped dir with two locked skills, neither installed
sandbox() {
  local sb
  sb=$(mktemp -d)
  mkdir -p "$sb/scripts" "$sb/bin" "$sb/.agents"
  cp "$SCRIPT" "$sb/scripts/"
  cat >"$sb/skills-lock.json" <<'EOF'
{
  "version": 1,
  "skills": {
    "alpha": {
      "source": "example/alpha"
    },
    "beta": {
      "source": "example/beta"
    }
  }
}
EOF
  cat >"$sb/bin/bunx" <<EOF
#!/usr/bin/env bash
echo call >>"$sb/calls"
sleep 1
for s in alpha beta; do mkdir -p "$sb/.agents/skills/\$s" && touch "$sb/.agents/skills/\$s/SKILL.md"; done
EOF
  chmod +x "$sb/bin/bunx"
  cp "$sb/bin/bunx" "$sb/bin/npx"
  echo "$sb"
}

restore() { PATH="$1/bin:$PATH" bash "$1/scripts/restore-skills.sh" "${@:2}"; }
calls()   { [ -f "$1/calls" ] && wc -l <"$1/calls" | tr -d ' ' || echo 0; }
lockgone() { [ ! -d "$1/.agents/.restore.lock" ] && [ ! -d "$1/.agents/.restore.lock.reclaim" ]; }
plant()   { mkdir "$1/.agents/.restore.lock" && printf '%s\n' "$2" >"$1/.agents/.restore.lock/owner"; }

echo "restore-skills.sh"

SB=$(sandbox)
restore "$SB" >/dev/null 2>&1
[ "$(calls "$SB")" = 1 ] && [ -f "$SB/.agents/skills/beta/SKILL.md" ] && lockgone "$SB" \
  && ok "missing skills are installed once and the lock is released" \
  || bad "fresh restore: calls=$(calls "$SB")"
restore "$SB" >/dev/null 2>&1
[ "$(calls "$SB")" = 1 ] \
  && ok "no-op when every locked skill is present" \
  || bad "re-ran the installer with nothing missing: calls=$(calls "$SB")"
[ "$(readlink "$SB/.claude/skills/alpha")" = "../../.agents/skills/alpha" ] && [ -f "$SB/.claude/skills/beta/SKILL.md" ] \
  && ok "each installed skill is linked into .claude/skills/" \
  || bad "links: alpha -> $(readlink "$SB/.claude/skills/alpha" || echo none)"
rm "$SB/.claude/skills/alpha"
ln -s ../../.agents/skills/gone "$SB/.claude/skills/gone"
restore "$SB" >/dev/null 2>&1
[ "$(calls "$SB")" = 1 ] && [ -L "$SB/.claude/skills/alpha" ] && [ ! -L "$SB/.claude/skills/gone" ] \
  && ok "with nothing to install, missing links are restored and dangling ones dropped" \
  || bad "relink: calls=$(calls "$SB") alpha=$([ -L "$SB/.claude/skills/alpha" ] && echo y || echo n) gone=$([ -L "$SB/.claude/skills/gone" ] && echo y || echo n)"
mkdir -p "$SB/.agents/skills/dropped" && touch "$SB/.agents/skills/dropped/SKILL.md"
ln -s ../../.agents/skills/dropped "$SB/.claude/skills/dropped"
ln -s "$SB/.agents/skills/alpha" "$SB/.claude/skills/hand-made"
mkdir -p "$SB/.claude/skills/real-dir"
restore "$SB" >/dev/null 2>&1
[ ! -L "$SB/.claude/skills/dropped" ] && [ -L "$SB/.claude/skills/hand-made" ] && [ -d "$SB/.claude/skills/real-dir" ] \
  && ok "a linked skill dropped from the lock is unlinked; other links and real dirs are kept" \
  || bad "unlink: dropped=$([ -L "$SB/.claude/skills/dropped" ] && echo kept || echo gone) hand-made=$([ -L "$SB/.claude/skills/hand-made" ] && echo kept || echo gone)"
rm -r "$SB"

SB=$(sandbox)
sleep 30 & DEAD=$!; kill "$DEAD"; wait "$DEAD" 2>/dev/null
plant "$SB" "$DEAD Thu Jan 1 00:00:00 1970"
t0=$(date +%s); restore "$SB" >/dev/null 2>&1; dt=$(( $(date +%s) - t0 ))
[ "$(calls "$SB")" = 1 ] && [ "$dt" -lt 10 ] && lockgone "$SB" \
  && ok "a lock whose owner is dead is reclaimed (${dt}s)" \
  || bad "dead-owner lock: calls=$(calls "$SB") took ${dt}s"
rm -r "$SB"

# The regression: a leftover lock whose PID now belongs to an unrelated live process.
SB=$(sandbox)
plant "$SB" "$$ Thu Jan 1 00:00:00 1970"
t0=$(date +%s); restore "$SB" >/dev/null 2>&1; dt=$(( $(date +%s) - t0 ))
[ "$(calls "$SB")" = 1 ] && [ "$dt" -lt 10 ] && lockgone "$SB" \
  && ok "a lock whose PID was reused by another live process is reclaimed (${dt}s)" \
  || bad "reused-PID lock: calls=$(calls "$SB") took ${dt}s — mistook an unrelated process for the owner"
rm -r "$SB"

SB=$(sandbox)
sleep 3 & HOLDER=$!
plant "$SB" "$HOLDER $(started "$HOLDER")"
t0=$(date +%s); restore "$SB" >/dev/null 2>&1; dt=$(( $(date +%s) - t0 ))
[ "$(calls "$SB")" = 1 ] && [ "$dt" -ge 2 ] && lockgone "$SB" \
  && ok "a live owner's lock is waited on, not stolen (${dt}s)" \
  || bad "live-owner lock: calls=$(calls "$SB") took ${dt}s"
wait "$HOLDER" 2>/dev/null
rm -r "$SB"

SB=$(sandbox)
sleep 30 & DEAD=$!; kill "$DEAD"; wait "$DEAD" 2>/dev/null
plant "$SB" "$DEAD Thu Jan 1 00:00:00 1970"
for _ in 1 2 3 4; do restore "$SB" >/dev/null 2>&1 & done
wait
[ "$(calls "$SB")" = 1 ] && lockgone "$SB" \
  && ok "4 concurrent restores over a stale lock run exactly one installer" \
  || bad "concurrent restores: calls=$(calls "$SB")"
rm -r "$SB"

# No clock: whole-second timestamps flake across a second boundary. The stub installer
# sleeps 1s before writing SKILL.md, so "returned before the install finished" is the
# observable proof that --background did not wait.
SB=$(sandbox)
out=$(restore "$SB" --background)
[ -f "$SB/.agents/skills/beta/SKILL.md" ] && returned_early=no || returned_early=yes
for _ in $(seq 1 15); do [ -f "$SB/.agents/skills/beta/SKILL.md" ] && lockgone "$SB" && break; sleep 1; done
[ "$returned_early" = yes ] && [ -n "$out" ] && [ "$(calls "$SB")" = 1 ] && lockgone "$SB" \
  && ok "--background returns before the install finishes, and the restore completes" \
  || bad "background: returned_early=$returned_early calls=$(calls "$SB")"
rm -r "$SB"

echo ""
echo "restore-skills: passed $PASS, failed $FAILED"
[ "$FAILED" -eq 0 ] && exit 0 || exit 1
