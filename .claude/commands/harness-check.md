---
description: Validate harness invariants — brain check (brain-axi CLI) + repo supplement (CLAUDE↔AGENTS symlink, sub-agent frontmatter, hook wiring)
---

Run `./scripts/harness-check.sh` and surface the result verbatim.

The script runs two layers:
1. `brain check` (brain-axi CLI) — integrity of `.brain/brain.db`: SQLite integrity, foreign keys, search index, shipped features verified, no open tasks on shipped features, plan/shot file hashes.
2. Repo-specific supplement — init.sh executable, CLAUDE↔AGENTS symlink, sub-agent frontmatter, `.kimi-code/agents` symlink, hook scripts wired in `.claude/settings.json` exist, restore-skills hook test.

If the script exits non-zero:
1. Quote the failing line(s).
2. For each failure, name the file or invariant violated.
3. Suggest the minimal fix (do not apply it without user approval — these checks usually catch state drift the user needs to see).

If exit is zero: state `Harness invariants intact — brain check + repo supplement passed.` and stop.

Do not run any other harness modification command afterward unless the user asks.
