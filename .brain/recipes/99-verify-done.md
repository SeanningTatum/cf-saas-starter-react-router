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

## 2. Regression smoke — e2e specs (default ON)

```bash
bun run test:e2e
```

**Default: run.** These are the thin, stable [`e2e/`](../../e2e) specs (auth + other critical paths) that CI re-runs on every PR. They are the automated regression net — the only layer that catches real wiring breakage on future changes. Skipping is the single biggest source of premature "done."

> We do **not** write a new spec per feature anymore. Feature-level proof is §4 (feature verification). Only add/extend an `e2e/` spec when a flow is critical enough to guard against future regressions in CI.

**Opt-out only when** the diff is purely:
- a tagged-error definition + `tagToTRPC` case (no procedure/repo touched)
- a brain doc / `.md` / comment-only change
- a unit-test-only change with no source touched
- an isolated helper in `app/lib/` with no consumer wiring change

If you opt out, append a one-line justification to your run note (`runs/<date>-<slug>.md`) under "Skipped checks". No silent skips.

## 3. Build (if cloudflare-touching)

If you changed `wrangler.jsonc`, bindings, workflows, runtime composition, or anything in `workers/`:

```bash
bun run build
```

This catches Workers-specific compat issues that local dev hides.

## 4. Feature verification (if UI)

If a user-visible flow changed, produce browser evidence — **do not claim UI works without a browser walk.**

Spawn the [`feature-verifier`](../../.claude/agents/feature-verifier.md) sub-agent with the feature slug + golden path + one error path. It drives the live app with the Playwright CLI (throwaway headless script run via `bun`), screenshots each state, and writes `.brain/features/<slug>/verifications/<date>.md` (see [`features/index.md`](../features/index.md)). Read its returned verdict:

- **PASS** → link the doc from `features/<slug>/<slug>.md` ("Testability") and the run note. Done.
- **FAIL / BLOCKED** → not done. Fix the blocker (or the bug) and re-run the verifier.

For a trivial UI tweak (copy, spacing) a manual `bun run dev` walk noted in the run note is enough — the verifier is for feature-level flows.

## 5. Brain coherence

Look at your diff (`git diff --stat`). For every changed path, ask:

| Touched | Brain doc to update |
|---------|---------------------|
| `app/db/schema.ts` | `high-level-architecture/data-models.md` |
| `app/repositories/` | `rules/repository.md` |
| `app/services/` | `rules/services.md` + `high-level-architecture/integrations.md` |
| `app/trpc/routes/` | `rules/routes.md` + `codebase/api.md` |
| `app/models/errors/` | `rules/errors.md` (and `tagToTRPC` in `app/lib/effect-trpc.ts`) |
| `app/auth/` | `high-level-architecture/security.md` + `features/authentication/authentication.md` |
| `wrangler.jsonc` | `rules/cloudflare.md` + `high-level-architecture/architecture.md` |
| `workflows/` | `rules/cloudflare.md` |
| `app/lib/` | `rules/library.md` |
| `app/components/` | `rules/frontend.md` |
| `app/routes/` | `rules/routes.md` + `rules/frontend.md` |
| `app/i18n/` | `codebase/i18n.md` |
| New / changed feature behaviour | `features/<slug>/<slug>.md` |
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
- [ ] `test:e2e` smoke green (default — opt-out only with run-note justification per §2)
- [ ] `build` green (if CF-touching)
- [ ] Feature verification doc PASS (if UI feature — via `feature-verifier`, per §4)
- [ ] `./scripts/harness-check.sh` green (feature-list invariants, brain link integrity, sub-agent frontmatter)
- [ ] Every diffed path → owning brain doc updated
- [ ] No five-non-negotiables grep hits
- [ ] Feature memo + `CHANGELOG.md` updated if applicable
- [ ] Run note closed (if opened)

Only after all boxes are checked: report task done to user.
