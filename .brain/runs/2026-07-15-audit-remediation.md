# Run: audit-remediation

_Started: 2026-07-15_
_Status: in-progress_

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
