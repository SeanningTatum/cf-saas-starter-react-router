#!/usr/bin/env bash
# Live eval for the admin-insights prompt module.
#
# Boots a local proxy worker (scripts/ai-eval-proxy) that exposes the Workers
# AI binding as an OpenAI-compatible endpoint, then runs the golden set
# through promptfoo with the same deterministic graders Vitest uses.
#
# Requirements: wrangler login (AI runs remote — inference charges apply),
# and a Node >= 22.22 for promptfoo (repo default v22.14 is too old; set
# PROMPTFOO_NODE to a newer binary if the nvm path below doesn't exist).
#
# Usage:
#   ./scripts/eval-admin-insights.sh                      # full run, console table
#   ./scripts/eval-admin-insights.sh --output <file.json> # also write a baseline artifact
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=8790
PROMPTFOO_NODE="${PROMPTFOO_NODE:-$HOME/.nvm/versions/node/v24.18.0/bin/node}"

if [[ ! -x "$PROMPTFOO_NODE" ]]; then
  echo "error: promptfoo needs Node ^20.20 || >=22.22; not found at $PROMPTFOO_NODE" >&2
  echo "set PROMPTFOO_NODE=/path/to/newer/node" >&2
  exit 1
fi

bun run scripts/ai-eval-proxy/gen-schema.ts

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

"$PROMPTFOO_NODE" node_modules/.bin/promptfoo eval \
  -c app/lib/ai/prompts/admin-insights/promptfooconfig.yaml \
  --no-cache "$@"
