#!/usr/bin/env bash
# Backwards-compatible wrapper — the general script is eval-prompt.sh.
exec "$(dirname "$0")/eval-prompt.sh" admin-insights "$@"
