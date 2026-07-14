# Feature: Feature Verification

_Last updated: 2026-07-13_

## Purpose

Feature-level proof that a user-visible flow actually works, without maintaining a hand-written `e2e/*.spec.ts` per feature. A `feature-verifier` sub-agent drives the **live app** with the Playwright CLI (a throwaway headless script run via `bun`), walks the golden path + one error path, screenshots each state, and writes a verdict doc. Replaces the old "write a per-feature e2e spec" mandate; automated **regression** coverage stays in a thin set of CI smoke specs.

## When It's Used

- Shipping a new user-visible feature (`recipes/add-feature.md` §7)
- Changing an existing feature's golden path or error handling
- `/verify-done` §4 flags a UI flow with no current verification doc
- Entry point: spawn the `feature-verifier` sub-agent with a feature slug + golden path + one error path

## How It Works

The `feature-verifier` sub-agent ([`.claude/agents/feature-verifier.md`](../../../.claude/agents/feature-verifier.md)):

1. Ensures the dev server is up (`http://localhost:5173`) and the project-pinned Chromium is installed (`node_modules/.bin/playwright install chromium`).
2. Authors a throwaway Playwright script in a temp dir (never under `e2e/`, never `*.spec.ts` — so CI never runs it), launches **bundled chromium `--disable-extensions` + clean profile** (never `channel:"chrome"`), and walks the flow.
3. Splits console output into `jsErrors` (real defects → FAIL) and `networkErrors` (expected on error-path steps). A hydration mismatch whose token is absent from `app/` (grep-confirmed) is an environment/extension artifact, not a FAIL.
4. Screenshots each asserted state, writes the verdict doc, deletes the temp script.

Two hard-won gotchas baked into the agent:
- **Fresh `browser.newContext()` for the error path** — the golden path leaves the context authenticated, and `/login` + `/sign-up` loaders redirect authenticated sessions to `/dashboard`.
- **Clean, extension-free browser** — a real dry run's phantom "hydration bug" (`caret-color: transparent` on signup inputs) was a password-manager extension injecting DOM, not app code.

### Persistence details

- Verdict docs: `.brain/features/<slug>/verifications/<date>.md` (from `features/_VERIFICATION_TEMPLATE.md`)
- Screenshots: `.brain/features/<slug>/screenshots/NN-<step>.png`
- Aggregate discoverability: `features/index.md` "Latest verification" column
- CI regression net (separate): thin smoke specs in `e2e/*.spec.ts`, run by the "E2E smoke" job in `.github/workflows/ci.yml`

### Testability

Verified against itself: [`authentication/verifications/2026-07-13.md`](../authentication/verifications/2026-07-13.md) — ✅ PASS (signup→dashboard golden path, bad-login error path). Harness invariants (including brain link integrity + feature-doc resolution) enforced by `scripts/harness-check.sh`.

## Key Files

| File | Role |
|------|------|
| [`.claude/agents/feature-verifier.md`](../../../.claude/agents/feature-verifier.md) | The sub-agent — CLI script author + verdict-doc writer |
| [`.brain/features/_VERIFICATION_TEMPLATE.md`](../_VERIFICATION_TEMPLATE.md) | Verdict-doc template |
| [`.brain/recipes/99-verify-done.md`](../../recipes/99-verify-done.md) | §2 smoke + §4 feature verification |
| [`.brain/recipes/add-feature.md`](../../recipes/add-feature.md) | §7 tests + verification |
| [`.brain/rules/library.md`](../../rules/library.md) / [`frontend.md`](../../rules/frontend.md) | Playwright CLI + verification convention |
| [`e2e/auth.spec.ts`](../../../e2e/auth.spec.ts) | The retained CI smoke spec (regression net) |

## Dependencies

- Tooling: `@playwright/test` (bundled Chromium), `bun`
- Verifies flows built on any feature; first target was `authentication` (feat-001)
- No app runtime dependency — it is a dev/CI-time verification harness

## Tagged Errors

None — this is a verification harness, not a runtime code path.

## Changelog

| Date | Type | Description |
|------|------|-------------|
| 2026-07-13 | feature | Feature-verifier (Playwright CLI) + per-feature folder layout for verifications/screenshots; replaces per-feature e2e specs. Hardened clean-browser launch + jsError/networkError console policy after a dry run surfaced an extension artifact. |
