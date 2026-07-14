# Verification: <Feature Name>

- **Slug**: `<slug>` (feature memo: `.brain/features/<slug>/<slug>.md`)
- **Date**: YYYY-MM-DD
- **Verified by**: feature-verifier (Playwright CLI — headless script via `bun`)
- **Base URL**: http://localhost:5173 _(dev server: started by agent | already running)_
- **Role**: admin (`admin@test.local`)
- **Verdict**: ✅ PASS | ❌ FAIL | ⛔ BLOCKED — _one line_

## Golden path

_What a user does for the happy case. State the steps you chose if derived from the feature doc._

| # | Step | Expected | Observed | Screenshot | Result |
|---|------|----------|----------|------------|--------|
| 01 | Sign in | Lands on `/dashboard` | | [`01-signin.png`](../screenshots/01-signin.png) | ✅ |
| 02 | … | | | [`02-…png`](../screenshots/02-….png) | |

## Error path

_One failure the feature must handle gracefully._

| # | Step | Expected failure surface | Observed | Screenshot | Result |
|---|------|--------------------------|----------|------------|--------|
| E1 | Submit invalid input | Inline `<FormMessage>` / toast, no crash | | [`E1-error.png`](../screenshots/E1-error.png) | ✅ |

## Console

Collected by the script's `console` + `pageerror` + `response` listeners, split by cause:

- **jsErrors** (uncaught exceptions + React/hydration warnings) — quote verbatim, or "none". **Any entry = FAIL.**
- **networkErrors** (`status@step`) — quote, or "none". Expected on error-path steps (e.g. 401 from a bad login); a FAIL only if it fired on a golden-path step.

## Findings for main thread

- Missing `data-testid`s, bugs observed, or "none".

## Verdict rationale

One paragraph: why PASS/FAIL. If FAIL/BLOCKED, the exact blocker.
