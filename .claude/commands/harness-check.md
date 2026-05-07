---
description: Validate harness invariants — feature_list state, brain integrity, sync rule, sub-agent frontmatter
---

Run `./scripts/harness-check.sh` and surface the result verbatim.

If the script exits non-zero:
1. Quote the failing line(s).
2. For each failure, name the file or invariant violated.
3. Suggest the minimal fix (do not apply it without user approval — these checks usually catch state drift the user needs to see).

If exit is zero: state `Harness invariants intact — N/N checks passed.` and stop.

Do not run any other harness modification command afterward unless the user asks.
