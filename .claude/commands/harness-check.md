---
description: Validate harness invariants — CLAUDE↔AGENTS symlink, sub-agent frontmatter, Kimi roster symlink, hook wiring, workflows
---

Run `./scripts/harness-check.sh` and surface the result verbatim.

The script checks: init.sh executable, CLAUDE↔AGENTS symlink, sub-agent frontmatter, `.kimi-code/agents` symlink, hook scripts wired in `.claude/settings.json` exist, restore-skills hook test, workflow scripts parse and resolve, brand-init fences cover every primitive.

If the script exits non-zero:
1. Quote the failing line(s).
2. For each failure, name the file or invariant violated.
3. Suggest the minimal fix (do not apply it without user approval — these checks usually catch state drift the user needs to see).

If exit is zero: state `Harness invariants intact.` and stop.

Do not run any other harness modification command afterward unless the user asks.
