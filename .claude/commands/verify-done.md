---
description: Run the project's verify-done checklist before declaring a task complete
---

Walk the [`/Users/sean/Desktop/personal-projects/cf-saas-starter-react-router/.brain/recipes/99-verify-done.md`](.brain/recipes/99-verify-done.md) checklist on the current change set. Do not skip steps.

Steps:

1. If the diff touches source (anything outside `.md` / comments / config / `__tests__/`) — spawn the `test-author` sub-agent with the changed paths. Report the tests it wrote or pruned and the regression each pins, plus any source defect it refused to work around. If skipped, justify why in one sentence.
2. Run `bun run typecheck` — paste tail of output, mark pass/fail.
3. Run `bun run test` — paste tail, mark pass/fail.
4. If diff touches any of `app/routes/`, `app/trpc/routes/`, `app/repositories/`, `app/auth/`, or migrations — run `bun run test:e2e` (smoke specs / CI regression net). If skipped, justify why in one sentence.
5. If diff touches `wrangler.jsonc`, `workers/`, `workflows/`, `app/runtime.ts`, or any binding wiring — run `bun run build`. If skipped, justify why.
6. If diff touches a UI feature flow (`app/components/`, `app/routes/*.tsx`) — spawn the `feature-verifier` sub-agent (slug + golden path + one error path) and report its verdict + the `.brain/features/<slug>/verifications/<date>.md` path. For a trivial tweak, state plainly whether you walked it in a browser. Do not claim UI works without a browser walk.
7. Run `git diff --stat` and for each changed path, name the brain doc that owns it (table in `99-verify-done.md`). Flag any path whose owning doc was not updated.
8. Run `bun run scripts/check-non-negotiables.ts` for the five non-negotiables (AST over the whole tree, not a grep over the diff). Quote any violation verbatim. Do NOT hand-grep for `throw`/`process.env`/`from "zod"`/`try {}` — that sweep was deleted from CI as unsound (`throw err` has no `new`, `'zod'` is not `"zod"`, and rule #4 is not expressible as a pattern).
9. Run `./scripts/harness-check.sh` (wraps `brain check` + repo supplement). Must exit zero. Quote any violation.
10. If a run note was opened for this task — `brain runs append <slug> --step "verify-done" --observed "<result tails>"` (or append+close the flat run note), then `brain progress add --summary "..." --next "..."`.

Output a final summary table:

| Check | Result |
|-------|--------|
| tests pin the change (`test-author`) | ✅ / ❌ / N/A (reason) |
| typecheck | ✅ / ❌ |
| test | ✅ / ❌ |
| test:e2e smoke | ✅ / ❌ / N/A (reason) |
| build | ✅ / ❌ / N/A (reason) |
| feature verification (doc path) | ✅ PASS / ❌ / N/A |
| brain coherence | ✅ / paths missing docs: ... |
| non-negotiables clean | ✅ / hits: ... |
| harness-check (brain check + supplement) | ✅ / ❌ (violation) |
| run note closed | ✅ / N/A |

Only if every row is ✅ or justified-N/A: tell the user the task is done. Otherwise list what is blocking.
