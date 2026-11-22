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

# The script's own helpers: started() so a planted "live owner" line reads as the script would
# write it, create_excl() to test the primitive the lock stands on.
eval "$(grep -E '^(started|create_excl)\(\)' "$SCRIPT")"

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
lockgone() { [ ! -e "$1/.agents/.restore.lock" ] && [ ! -e "$1/.agents/.restore.lock.reclaim" ]; }
plant()   { printf '%s\n' "$2" >"$1/.agents/.restore.lock"; }

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
ln -s /nonexistent/external-skill "$SB/.claude/skills/external"
mkdir -p "$SB/.claude/skills/real-dir"
restore "$SB" >/dev/null 2>&1
[ ! -L "$SB/.claude/skills/dropped" ] && [ -L "$SB/.claude/skills/hand-made" ] && [ -L "$SB/.claude/skills/external" ] \
  && [ -d "$SB/.claude/skills/real-dir" ] \
  && ok "a linked skill dropped from the lock is unlinked; other links (even dangling) and real dirs are kept" \
  || bad "unlink: dropped=$([ -L "$SB/.claude/skills/dropped" ] && echo kept || echo gone) hand-made=$([ -L "$SB/.claude/skills/hand-made" ] && echo kept || echo gone) external=$([ -L "$SB/.claude/skills/external" ] && echo kept || echo gone)"
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
for i in 1 2 3 4; do restore "$SB" >/dev/null 2>"$SB/err.$i" & done
wait
# On failure, print each restore's stderr: it names every lock that was reclaimed.
[ "$(calls "$SB")" = 1 ] && lockgone "$SB" \
  && ok "4 concurrent restores over a stale lock run exactly one installer" \
  || { bad "concurrent restores: calls=$(calls "$SB")"; cat "$SB"/err.* 2>/dev/null | sed 's/^/      /'; }
rm -r "$SB"

# The lock changes hands while a waiter judges its old owner: the owner it read exits (and
# removes its lock), a new restore takes the lock, and only then does the waiter learn the old
# owner is dead. It must leave the new owner's lock alone. The stub ps makes that order
# certain: asked about the old owner, it first swaps in a live owner's lock, then answers "dead".
SB=$(sandbox)
sleep 30 & DEAD=$!; kill "$DEAD"; wait "$DEAD" 2>/dev/null
plant "$SB" "$DEAD Thu Jan 1 00:00:00 1970"
LIVE="$$ $(started $$)"
REAL_PS=$(command -v ps)
cat >"$SB/bin/ps" <<EOF
#!/usr/bin/env bash
if [ "\${!#}" = "$DEAD" ] && [ ! -e "$SB/handed-over" ]; then
  touch "$SB/handed-over"
  printf '%s\n' "$LIVE" >"$SB/.agents/.restore.lock"
  exit 1
fi
exec "$REAL_PS" "\$@"
EOF
chmod +x "$SB/bin/ps"
(sleep 2; rm -f "$SB/.agents/.restore.lock") & RELEASE=$!
restore "$SB" >/dev/null 2>"$SB/err"
wait "$RELEASE" 2>/dev/null
[ -e "$SB/handed-over" ] && ! grep -q "reclaiming" "$SB/err" && [ "$(calls "$SB")" = 1 ] && lockgone "$SB" \
  && ok "a lock that changed hands while its old owner was being judged is left to the new owner" \
  || { bad "handed-over lock: calls=$(calls "$SB") swapped=$([ -e "$SB/handed-over" ] && echo y || echo n)"; sed 's/^/      /' "$SB/err"; }
rm -r "$SB"

# The lock stands on this: of many racing creators of one path, exactly one succeeds.
# (`mkdir` does not promise it on every host: uutils coreutils on Ubuntu 26.04 lets several
# racers win; see create_excl in the script.)
SB=$(mktemp -d); wrong=0
for round in $(seq 1 25); do
  for i in 1 2 3 4 5 6 7 8; do (create_excl "$SB/l.$round" "$i" && echo won >>"$SB/w.$round") & done
  wait
  [ "$(wc -l <"$SB/w.$round" 2>/dev/null | tr -d ' ')" = 1 ] || wrong=$((wrong+1))
done
[ "$wrong" = 0 ] \
  && ok "8 racing creators of one lock file: exactly one wins, 25 rounds" \
  || bad "create_excl let more or fewer than one creator win in $wrong of 25 rounds"
rm -r "$SB"

# A lock directory left by an older version of this script, old enough, is reclaimed.
SB=$(sandbox)
mkdir "$SB/.agents/.restore.lock" && touch -t 202001010000 "$SB/.agents/.restore.lock"
restore "$SB" >/dev/null 2>&1
[ "$(calls "$SB")" = 1 ] && lockgone "$SB" \
  && ok "an old-format lock directory is reclaimed" \
  || bad "old-format lock: calls=$(calls "$SB")"
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
