# Run: audit-remediation

_Started: 2026-07-15_
_Status: shipped_

## Task

Fix all findings from the 4-agent quality audit (security, Effect TS core, DRY, i18n, tests) — EXCEPT deleting the unused ShadCN scaffold files (`admin/components/data-table.tsx`, `section-cards.tsx`, `chart-area-interactive.tsx`, `nav-documents.tsx`, `nav-secondary.tsx`), which stay as boilerplate for future users.

## Domain

mixed

## Plan

Coordinator + parallel Sonnet sub-agents, two waves (disjoint file ownership per agent):

**Wave 1 (parallel):**
1. Agent A — core plumbing: `app/lib/effect-trpc.ts` (leak fix, runtime cast, assertNever/isAppError fallback), `app/trpc/index.ts` (createTRPCContext → SessionLive), `app/trpc/router.ts` (gate getUsers, drop optional chain), `app/runtime.ts` + `workers/app.ts` (auth via AuthApiLive), `app/services/workflows.ts` (binding guard), `app/routes/api/trpc.$.ts` (structured logger).
2. Agent B — repositories: `app/repositories/{user,analytics,bucket}.ts` onto `effect-utils` helpers, delete `bulkUpdateUsersUnsafe`, `BucketNotFoundError` wiring via `requireFound`, `app/routes/api/upload-file.ts` (auth + size/type validation + JSON response shapes), `app/db/schema.ts` dead type.
3. Agent C — frontend DRY: auth-gating helpers in `app/lib/` + 5 loaders, `runAdminAction` helper + ban-user bug, shared `FeatureCard`, theme-toggle dedupe, shared locale cookie, date-utils adoption, `buildUserInsights` extraction, `cn()` fixes, real sidebar user + working logout.

**Wave 2 (after wave 1, parallel):**
4. Agent D — i18n sweep: `file-upload.tsx`, `user-data-table.tsx`, `nav-user.tsx`, `distribution-chart.tsx`, `site-header.tsx` + en/zh locale files.
5. Agent E — test backfill: repos mutation paths, `services/database.ts`, `services/logger.ts` (export helpers), `schemas/{bucket,pagination}.ts`, `runProcedure`, analytics QueryError paths, email-pattern rejection, `shouldLog` extraction, `chainable` spy support.

**Close:** effect-ts-enforcer review → /verify-done → brain updates → close run note.

---

## Step 1 — Wave 1 complete

_2026-07-15 11:43_

All 3 wave-1 agents done. Integration check by coordinator: typecheck PASS, 157/157 tests PASS, build PASS (agent C).

Key outcomes:
- A: getUsers consolidated → single protectedProcedure w/ safe projection (id/name/image/createdAt); toTRPC fallback no longer leaks err.message; runProcedure honestly typed, layer failures mapped via runPromiseExit; SessionLive wired into createTRPCContext (per-request local provide, kept service); prod auth through AuthApiLive(baseURL) factory, dead ternary dropped; WorkflowsLive fails fast on missing binding.
- B: user/analytics/bucket repos onto tryQuery/tryUpdate/tryDelete/requireFound (+new requireFoundOrFail helper); bulkUpdateUsersUnsafe DELETED; bucket.get now fails BucketNotFoundError (zero prod callers); upload-file: session 401 + 10MB/type-allowlist validation (app/lib/constants/upload.ts) + JSON shapes all branches; dead schema type deleted.
- C: runAdminAction fixes ban-toast bug; real sidebar user + working logout (Account/Billing/Notifications dropped — no routes exist); requireSession/requireAdmin/redirectIfAuthenticated in app/lib/session.ts applied to 5 loaders; shared FeatureCard; runBulkUserAction in admin.ts; shared themeItems; shared localeCookie; date-utils gains zh locale, used by table+chart; buildUserInsights extracted w/ named constants; cn() fixes; Schema.is guards replace as-casts.

Next: wave 2 spawned — Agent D (i18n sweep), Agent E (test backfill).

---

## Step 2 — Wave 2 + close-out

_2026-07-15 12:15_

- Wave 2 done: i18n sweep (upload namespace, admin table/nav/toasts, en+zh parity) + test backfill (157→222 tests, all 11 audit gaps filled).
- effect-ts-enforcer found 4 seams from parallel agents; all fixed by coordinator: dead upload error UI (fetcher.data.success branch), createTRPCContext runPromise→runPromiseExit + edge catch in workers/app.ts, shared getInitials in lib/utils, dropped redundant non-null assertions.
- verify-done: typecheck/test/build PASS; e2e FAIL was **environmental** — Playwright baseURL 5173 hit an unrelated project's dev server (Vite silently port-bumps). Fixed playwright.config.ts: `--strictPort` + `E2E_PORT` override. E2e then 2/2 PASS on port 5199.
- Brain docs updated (8 by doc agent + architecture.md/integrations.md/frontend.md/library.md by coordinator).
- Pre-PR Greptile review: 4 findings. P1 (user decided): removed image/svg+xml from upload allowlist; added magic-byte validation (`matchesMagicBytes`). P2/P3: getSession wrapped in Effect.tryPromise in upload route; `t` added to FileUpload effect deps. Final: 228/228 tests.

## Final

_Closed: 2026-07-15_

- Shipped: branch `refactor/audit-remediation` (commits: remediation + Greptile fixes), PR opened from this branch
- Brain docs updated: rules/{library,repository,routes,services,errors,frontend}.md, codebase/{api,i18n}.md, high-level-architecture/{architecture,integrations}.md, CHANGELOG.md
- Left undone: feature-verifier browser walk of admin flow (killed by user mid-run; e2e + manual signup walk cover auth); FileUpload component still unrouted (pre-existing)
- Surprises worth remembering: Vite port auto-bump made e2e silently test a DIFFERENT project's app on 5173 — now pinned with --strictPort; parallel fixer agents need a seam-review pass (enforcer caught 4 cross-agent inconsistencies)

## Baseline

```
$ ./init.sh --baseline
=== Baseline summary ===
typecheck:     PASS
test:          PASS
harness-check: PASS
Baseline green. Proceed to task.
```

Branch: main @ 8547acb, tree clean.

## Explicitly out of scope

- Deleting ShadCN scaffold files (user decision 2026-07-15: keep as boilerplate).
- Commented-out `NavDocuments`/`NavSecondary` render lines stay.
