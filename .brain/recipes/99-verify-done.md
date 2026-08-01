# Recipe: Verify done (termination check)

Run this before declaring a task complete. Externalises the "am I finished?" judgment so the agent does not declare victory on a half-built feature.

## Why this exists

Agents tend to stop at "code compiles" or "tests pass without re-running them." This list forces an actual end-to-end pass + brain-coherence check before handoff.

## The registry decides WHICH gates run — not this prose

```bash
brain verify --stage verify      # everything below that is a command
brain verify --only <name>       # re-run one gate after a fix
```

[`.brain/verify.json`](../verify.json) is the single source of truth for the gate
list and which stage each belongs to. Run it; don't hand-assemble the commands.

This matters because the applicability rules used to be written down in **three
places that disagreed** — this recipe said "e2e default-on for source changes",
[`/verify-done`](../../.claude/commands/verify-done.md) used a path list, and
[`verify-done-runner`](../../.claude/agents/verify-done-runner.md) used a
narrower "cross-component" judgment. An agent could pick whichever reading
demanded least, and nothing caught it. The registry has one answer.

Every gate execution also appends a row to `runs/gates.jsonl`; `brain metrics`
reports first-pass rate and which gate actually catches things. A gate that has
never failed is worth questioning, not trusting.

The sections below explain **why** each gate exists and what to do when it fails.
They are no longer the place that decides whether it applies.

## 1. Tests that pin the change (if source changed)

Before running the suite, make sure the change is actually *pinned* by a test — a green run of tests that never exercised the new behaviour proves nothing.

Spawn the [`test-author`](../../.claude/agents/test-author.md) sub-agent with the changed paths (or `"my branch"`). It writes to `**/__tests__/**` only, applies the gate — every test must name the specific regression it would catch — and prunes redundant tests rather than stacking near-clones next to them. Test count going *down* is a valid outcome.

Non-negotiable #4 is the floor: every helper in `app/lib/` and every repository in `app/repositories/` has a co-located test. Above that floor the question is not "did coverage go up?" but **"would this suite fail if someone reverted the fix?"**

If `test-author` reports a source defect instead of writing a test, that is the expected behaviour — it does not edit app code. Fix the defect, then re-run it.

**Skip only when** the diff touches no source: brain docs / `.md`, comments, config, or a test-only change. Note the skip in the run note.

## 2. Code health

```bash
bun run typecheck
bun run test
```

Both must be green **on the post-change tree**, not from memory of an earlier run.

## 3. Regression smoke — e2e specs (default ON)

```bash
bun run test:e2e
```

**Default: run.** These are the thin, stable [`e2e/`](../../e2e) specs (auth + other critical paths) that CI re-runs on every PR. They are the automated regression net — the only layer that catches real wiring breakage on future changes. Skipping is the single biggest source of premature "done."

> We do **not** write a new spec per feature anymore. Feature-level proof is §5 (feature verification). Only add/extend an `e2e/` spec when a flow is critical enough to guard against future regressions in CI.

**Opt-out only when** the diff is purely:
- a tagged-error definition + `tagToTRPC` case (no procedure/repo touched)
- a brain doc / `.md` / comment-only change
- a unit-test-only change with no source touched
- an isolated helper in `app/lib/` with no consumer wiring change

If you opt out, append a one-line justification to your run note (`runs/<date>-<slug>.md`) under "Skipped checks". No silent skips.

## 4. Build (if cloudflare-touching)

If you changed `wrangler.jsonc`, bindings, workflows, runtime composition, or anything in `workers/`:

```bash
bun run build
```

This catches Workers-specific compat issues that local dev hides.

## 5. Feature verification (if UI)

If a user-visible flow changed, produce browser evidence — **do not claim UI works without a browser walk.**

Spawn the [`feature-verifier`](../../.claude/agents/feature-verifier.md) sub-agent with the feature slug + golden path + one error path (the standard is `brain playbook verify`). It drives the live app with the Playwright CLI (throwaway headless script run via `bun`), screenshots each state (`brain shots add --feature <slug> --step NN-name`), and writes `.brain/features/<slug>/verifications/<date>.md` (see [`features/index.md`](../features/index.md)). Read its returned verdict:

- **PASS** → link the doc from `features/<slug>/<slug>.md` ("Testability") and the run note. Done.
- **FAIL / BLOCKED** → not done. Fix the blocker (or the bug) and re-run the verifier.

For a trivial UI tweak (copy, spacing) a manual `bun run dev` walk noted in the run note is enough — the verifier is for feature-level flows.

## 6. Brain coherence

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

## 7. Five non-negotiables sweep

```bash
bun run scripts/check-non-negotiables.ts
```

Walks the TypeScript AST over the whole tree. Exit 1 lists `rule — file:line — detail`.

> **Do not grep for these.** This step used to be
> `git diff | grep -E '\bthrow\b|process\.env|from "zod"|try\s*\{'`, which is the
> same unsound sweep CI deleted: `throw err` has no `new`, `'zod'` is not
> `"zod"`, `try` inside a comment matches, a violation that merely *moves*
> between files vanishes from the diff, and non-negotiable #4 (a unit test per
> helper and repository) cannot be expressed as a text pattern at all. The
> checker covers all five structurally and carries 41 failing fixtures.

Any hit = re-read [`.brain/codebase/effect-ts.md`](../codebase/effect-ts.md). Likely violation:
- `throw` outside `Effect.tryPromise.catch` → use `Effect.fail(new TaggedError(...))`
- `process.env` → use `CloudflareEnv` Tag
- `from "zod"` → use Effect Schema
- bare `try {}` → use `Effect.tryPromise`
- an exported helper or repository with no sibling `__tests__/<name>.test.ts` → write the test

## 8. Harness invariants

```bash
./scripts/harness-check.sh
```

Runs `brain check` (brain-state invariants) + the repo supplement (sync rule, sub-agent frontmatter, dead links). Must exit zero.

## 9. Close the run note + checkpoint

If you opened one, append a final entry via `brain runs append <slug> --step "verify-done" --observed "<result tails>"` (or the flat run note), then `brain progress add --summary "..." --next "..."`: what shipped, what is left, what surprised you. Future you will read this.

## Definition of done

- [ ] Change is pinned by a test (if source changed — via `test-author`, per §1)
- [ ] `typecheck` green
- [ ] `test` green
- [ ] `test:e2e` smoke green (default — opt-out only with run-note justification per §3)
- [ ] `build` green (if CF-touching)
- [ ] Feature verification doc PASS (if UI feature — via `feature-verifier`, per §5)
- [ ] `./scripts/harness-check.sh` green (`brain check` brain-state invariants + repo supplement: sync rule, sub-agent frontmatter, dead links)
- [ ] Every diffed path → owning brain doc updated
- [ ] No five-non-negotiables grep hits
- [ ] Feature memo + `CHANGELOG.md` updated if applicable
- [ ] Run note closed (if opened)

Only after all boxes are checked: report task done to user.
