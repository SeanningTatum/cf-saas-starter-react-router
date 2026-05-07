---
description: Run the project's verify-done checklist before declaring a task complete
---

Walk the [`/Users/sean/Desktop/personal-projects/cf-saas-starter-react-router/.brain/recipes/99-verify-done.md`](.brain/recipes/99-verify-done.md) checklist on the current change set. Do not skip steps.

Steps:

1. Run `bun run typecheck` — paste tail of output, mark pass/fail.
2. Run `bun run test` — paste tail, mark pass/fail.
3. If diff touches any of `app/routes/`, `app/trpc/routes/`, `app/repositories/`, `app/auth/`, or migrations — run `bun run test:e2e`. If skipped, justify why in one sentence.
4. If diff touches `wrangler.jsonc`, `workers/`, `workflows/`, `app/runtime.ts`, or any binding wiring — run `bun run build`. If skipped, justify why.
5. If diff touches UI (`app/components/`, `app/routes/*.tsx`) — explicitly state whether you opened a browser to walk the golden path. If you did not, say so plainly. Do not claim UI works without manual verification.
6. Run `git diff --stat` and for each changed path, name the brain doc that owns it (table in `99-verify-done.md`). Flag any path whose owning doc was not updated.
7. Grep the diff for the five non-negotiables: `throw` outside `Effect.tryPromise.catch`, `process.env`, `from "zod"`, bare `try {}`. Quote any hit.
8. If a `.brain/runs/<file>.md` was opened for this task — append a final entry and close it.

Output a final summary table:

| Check | Result |
|-------|--------|
| typecheck | ✅ / ❌ |
| test | ✅ / ❌ |
| test:e2e | ✅ / ❌ / N/A (reason) |
| build | ✅ / ❌ / N/A (reason) |
| manual UI smoke | ✅ / ❌ / N/A |
| brain coherence | ✅ / paths missing docs: ... |
| non-negotiables clean | ✅ / hits: ... |
| run note closed | ✅ / N/A |

Only if every row is ✅ or justified-N/A: tell the user the task is done. Otherwise list what is blocking.
