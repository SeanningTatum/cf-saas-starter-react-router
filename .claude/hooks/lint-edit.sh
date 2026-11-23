#!/usr/bin/env bash
# PostToolUse hook (Edit|Write): lint the one file an agent just changed and hand the findings back.
#
# It formats the file and applies Biome's safe fixes, then prints what is left on stderr and
# exits 2, which is how a PostToolUse hook shows text to the agent. A clean file exits 0 silently.
# It never fails an edit for its own reasons: with no jq, no bun, no installed tools, or a file
# outside a checkout that has a biome.jsonc, it does nothing.
#
# The checkout is found from the file, not from $CLAUDE_PROJECT_DIR: an agent in a git worktree
# edits files whose tools and config live in that worktree.

set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0
command -v bun >/dev/null 2>&1 || exit 0

file=$(jq -r '.tool_input.file_path // empty' 2>/dev/null) || exit 0
[ -n "$file" ] && [ -f "$file" ] || exit 0

# The same extensions as LINTABLE_FILE in scripts/lib/lint-constants.ts; checked here to save a bun start.
case "$file" in
  *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.json | *.jsonc | *.css) ;;
  *) exit 0 ;;
esac

root=$(dirname "$file")
while [ "$root" != "/" ] && [ ! -f "$root/biome.jsonc" ]; do
  root=$(dirname "$root")
done
[ -f "$root/biome.jsonc" ] || exit 0
[ -x "$root/node_modules/.bin/biome" ] || exit 0
[ -f "$root/scripts/lint-all.ts" ] || exit 0

relative=${file#"$root"/}

# The runner strips GIT_* from each tool it starts (scripts/lib/shell.ts), so a git hook's GIT_DIR never reaches them.
findings=$(cd "$root" && bun scripts/lint-all.ts --fix "$relative" 2>&1)
status=$?

[ "$status" -eq 0 ] && exit 0

{
  echo "Lint findings in $relative. Formatting and safe fixes are already applied; fix the rest now:"
  echo "$findings"
} >&2
exit 2
