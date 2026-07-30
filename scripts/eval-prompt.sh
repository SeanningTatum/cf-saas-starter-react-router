#!/usr/bin/env bash
# Live eval for any prompt module in app/lib/ai/prompts/<name>.
#
# Boots a local proxy worker (scripts/ai-eval-proxy) that exposes the Workers
# AI binding as an OpenAI-compatible endpoint, then runs the module's golden
# set through promptfoo with the same deterministic graders Vitest uses
# (scripts/promptfoo/{tests,assert-golden}.ts, driven by PROMPT_MODULE_DIR).
#
# Requirements: wrangler login (AI runs remote — inference charges apply),
# and a Node >= 22.22 for promptfoo (repo default v22.14 is too old; set
# PROMPTFOO_NODE to a newer binary if the nvm path below doesn't exist).
#
# Usage:
#   ./scripts/eval-prompt.sh <module-name> [promptfoo args...]
#   ./scripts/eval-prompt.sh admin-insights --max-concurrency 2 --output evals/run.json
#   ./scripts/eval-prompt.sh support-ticket-triage --filter-failing evals/prev.json
set -euo pipefail
cd "$(dirname "$0")/.."

MODULE="${1:-}"
if [[ -z "$MODULE" || ! -d "app/lib/ai/prompts/$MODULE" ]]; then
  echo "usage: $0 <module-name> [promptfoo args...]" >&2
  echo "modules: $(ls app/lib/ai/prompts)" >&2
  exit 1
fi
shift

PORT=8790
PROMPTFOO_NODE="${PROMPTFOO_NODE:-$HOME/.nvm/versions/node/v24.18.0/bin/node}"

if [[ ! -x "$PROMPTFOO_NODE" ]]; then
  echo "error: promptfoo needs Node ^20.20 || >=22.22; not found at $PROMPTFOO_NODE" >&2
  echo "set PROMPTFOO_NODE=/path/to/newer/node" >&2
  exit 1
fi

bun run scripts/ai-eval-proxy/gen-schema.ts "$MODULE"

cleanup() {
  [[ -n "${PROXY_PID:-}" ]] && kill "$PROXY_PID" 2>/dev/null || true
}
trap cleanup EXIT

bunx wrangler dev --config scripts/ai-eval-proxy/wrangler.toml \
  --port "$PORT" --ip 127.0.0.1 >/tmp/ai-eval-proxy.log 2>&1 &
PROXY_PID=$!

for _ in $(seq 1 30); do
  curl -sf -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null && break
  curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break  # 404 is fine — server is up
  sleep 1
done

export PROMPT_MODULE="$MODULE"
export PROMPT_MODULE_DIR="app/lib/ai/prompts/$MODULE"

"$PROMPTFOO_NODE" node_modules/.bin/promptfoo eval \
  -c scripts/promptfoo/promptfooconfig.yaml \
  --no-cache "$@"
