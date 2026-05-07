# Recipe: Verify done (termination check)

Run this before declaring a task complete. Externalises the "am I finished?" judgment so the agent does not declare victory on a half-built feature.

## Why this exists

Agents tend to stop at "code compiles" or "tests pass without re-running them." This list forces an actual end-to-end pass + brain-coherence check before handoff.

## 1. Code health

```bash
bun run typecheck
bun run test
```

Both must be green **on the post-change tree**, not from memory of an earlier run.

## 2. End-to-end (if cross-component)

If your change touched any of: route + procedure + repository + UI / auth / forms / migration:

```bash
bun run test:e2e
```

E2E is the only layer that catches real wiring breakage. Skipping it is the single biggest source of premature "done."

## 3. Build (if cloudflare-touching)

If you changed `wrangler.jsonc`, bindings, workflows, runtime composition, or anything in `workers/`:

```bash
bun run build
```

This catches Workers-specific compat issues that local dev hides.

## 4. Manual smoke (if UI)

If a user-visible flow changed: open `bun run dev` → walk the golden path → walk one error path. Note exactly what you exercised in the run note. **Do not claim UI works without opening the browser.**

## 5. Brain coherence

Look at your diff (`git diff --stat`). For every changed path, ask:

| Touched | Brain doc to update |
|---------|---------------------|
| `app/db/schema.ts` | `high-level-architecture/data-models.md` |
| `app/repositories/` | `rules/repository.md` |
| `app/services/` | `rules/services.md` + `high-level-architecture/integrations.md` |
| `app/trpc/routes/` | `rules/routes.md` + `codebase/api.md` |
| `app/models/errors/` | `rules/errors.md` (and `tagToTRPC` in `app/lib/effect-trpc.ts`) |
| `app/auth/` | `high-level-architecture/security.md` + `features/authentication.md` |
| `wrangler.jsonc` | `rules/cloudflare.md` + `high-level-architecture/architecture.md` |
| `workflows/` | `rules/cloudflare.md` |
| `app/lib/` | `rules/library.md` |
| `app/components/` | `rules/frontend.md` |
| `app/routes/` | `rules/routes.md` + `rules/frontend.md` |
| `app/i18n/` | `codebase/i18n.md` |
| New / changed feature behaviour | `features/<slug>.md` |
| Architectural shift | `CHANGELOG.md` |

(Same table the `brain-reminder.sh` hook prints at commit time — front-loading it.)

## 6. Five non-negotiables sweep

Grep your diff:

```bash
git diff --stat | head
git diff | grep -E '^\+' | grep -E '\bthrow\b|process\.env|from "zod"|try\s*\{'
```

Any hit = re-read [`.brain/codebase/effect-ts.md`](../codebase/effect-ts.md). Likely violation:
- `throw` outside `Effect.tryPromise.catch` → use `Effect.fail(new TaggedError(...))`
- `process.env` → use `CloudflareEnv` Tag
- `from "zod"` → use Effect Schema
- bare `try {}` → use `Effect.tryPromise`

## 7. Close the run note

If you opened one, append a final entry: what shipped, what is left, what surprised you. Future you will read this.

## Definition of done

- [ ] `typecheck` green
- [ ] `test` green
- [ ] `test:e2e` green (or N/A documented in run note)
- [ ] `build` green (if CF-touching)
- [ ] Manual smoke walked (if UI)
- [ ] Every diffed path → owning brain doc updated
- [ ] No five-non-negotiables grep hits
- [ ] Feature memo + `CHANGELOG.md` updated if applicable
- [ ] Run note closed (if opened)

Only after all boxes are checked: report task done to user.
