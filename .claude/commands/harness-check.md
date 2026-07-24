---
description: Validate harness invariants — brain check (brain-axi CLI) + repo supplement (sync rule, sub-agent frontmatter, dead links)
---

Run `./scripts/harness-check.sh` and surface the result verbatim.

The script runs two layers:
1. `brain check` (brain-axi CLI) — authoritative brain-state invariants (feature_list, one-in-progress, doc paths, dependency refs, progress.md, plan/review integrity, verification Verdict lines).
2. Repo-specific supplement — HARNESS.md exists, init.sh executable, CLAUDE↔AGENTS sync, sub-agent frontmatter, core recipes, dead internal links.

If the script exits non-zero:
1. Quote the failing line(s).
2. For each failure, name the file or invariant violated.
3. Suggest the minimal fix (do not apply it without user approval — these checks usually catch state drift the user needs to see).

If exit is zero: state `Harness invariants intact — brain check + repo supplement passed.` and stop.

Do not run any other harness modification command afterward unless the user asks.
