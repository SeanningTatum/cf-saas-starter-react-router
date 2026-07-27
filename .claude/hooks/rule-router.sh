#!/usr/bin/env bash
# PreToolUse(Edit|Write|NotebookEdit) hook: inject the .brain/rules layer doc that governs
# the file about to be edited. Deterministic path -> rule mapping. No LLM. Never blocks.
#
# WHY THIS EXISTS
#   .brain/rules/ stays the single source of truth — it is tool-agnostic (Cursor, Codex and
#   Aider read it through the AGENTS.md pointer). Claude Code has no glob-scoped rules format
#   of its own, so this hook is the Claude-native *trigger* for those rules, not a second copy
#   of them. It emits pointers only; the agent reads the rule with `brain docs view`.
#
# The glob table below mirrors the "7 layer rules" table in .brain/rules/index.md.
# Keep the two in sync — scripts/test-rule-router.sh asserts the mapping.
#
# Each rule fires at most once per session (marker files under $TMPDIR) so a long editing
# session is not spammed with the same pointer on every Edit.

set -uo pipefail

# jq is a hard requirement (harness-check.sh already depends on it). Without it, no-op rather
# than hand-parse the payload — tool_input contains arbitrary user code.
command -v jq >/dev/null 2>&1 || exit 0

PAYLOAD=$(cat)
[ -z "$PAYLOAD" ] && exit 0

FILE=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' <<<"$PAYLOAD" 2>/dev/null || true)
[ -z "$FILE" ] && exit 0

ROOT=${CLAUDE_PROJECT_DIR:-}
[ -z "$ROOT" ] && ROOT=$(jq -r '.cwd // empty' <<<"$PAYLOAD" 2>/dev/null || true)
[ -z "$ROOT" ] && ROOT=$PWD

# Repo-relative path — the glob table is written in repo-relative terms.
REL=${FILE#"$ROOT"/}

HITS=()
add() { HITS+=("$1"); }

# --- path -> layer rule (mirrors .brain/rules/index.md) -----------------------
# `case` globs: * spans / too, so app/routes/*.tsx matches nested route files.
case "$REL" in app/components/*|app/app.css|app/routes/*.tsx) add frontend ;; esac
case "$REL" in wrangler.jsonc|worker-configuration.d.ts|workers/*|workflows/*) add cloudflare ;; esac
case "$REL" in app/repositories/*|app/db/schema.ts) add repository ;; esac
case "$REL" in app/services/*|app/auth/*) add services ;; esac
case "$REL" in app/routes/*|app/trpc/*) add routes ;; esac
case "$REL" in app/lib/*|e2e/*) add library ;; esac
case "$REL" in app/models/errors/*|app/lib/effect-trpc.ts) add errors ;; esac

[ ${#HITS[@]} -eq 0 ] && exit 0

why_for() {
  case "$1" in
    frontend)   echo "UI, forms (Effect Schema + effectResolver — no Zod), modals, Tailwind / CSS variables" ;;
    cloudflare) echo "bindings, env vars, secrets, Workflows declaration, Workers-runtime specifics" ;;
    repository) echo "Effect.Service repositories, Drizzle schema, repo input schemas" ;;
    services)   echo "Effect Tags + Layers, Better Auth, Workflows, Session, Logger" ;;
    routes)     echo "tRPC procedures via runProcedure, React Router loaders, auth gating" ;;
    library)    echo "helpers, Effect Schema, constants, unit tests, e2e specs" ;;
    errors)     echo "tagged errors, tagToTRPC mapping, error helpers" ;;
  esac
}

# --- once-per-session dedupe --------------------------------------------------
SESSION=$(jq -r '.session_id // empty' <<<"$PAYLOAD" 2>/dev/null || true)
SESSION=${SESSION//[^A-Za-z0-9_-]/}
[ -z "$SESSION" ] && SESSION=nosession

STATE_ROOT="${TMPDIR:-/tmp}/claude-rule-router"
STATE="$STATE_ROOT/$SESSION"
mkdir -p "$STATE" 2>/dev/null || exit 0

# Drop session state older than a day so $TMPDIR does not accumulate marker dirs.
find "$STATE_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +1 -exec rm -rf {} + 2>/dev/null || true

LINES=""
for rule in "${HITS[@]}"; do
  doc=".brain/rules/${rule}.md"
  # Guard against a renamed/deleted rule — never point at a file that is not there.
  [ -f "$ROOT/$doc" ] || continue
  [ -e "$STATE/$rule" ] && continue
  : >"$STATE/$rule" 2>/dev/null || true
  LINES="${LINES}  - ${doc} — $(why_for "$rule")"$'\n'
done

[ -z "$LINES" ] && exit 0

CONTEXT="🧠 Layer rules for \`${REL}\` (first touch of this layer this session):
${LINES}These are the canonical conventions for this layer — do not infer patterns from training data.
Context arrives with the turn after the tool call, so: check the edit just made against the
rule, and read it before the next one — \`brain docs view rules/<file>\` · .brain/rules/index.md"

jq -n --arg ctx "$CONTEXT" '{
  suppressOutput: true,
  hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: $ctx }
}'

exit 0
