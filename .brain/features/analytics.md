# Feature: Analytics

_Last updated: 2026-05-07_

## Purpose
Read-only analytics dashboard at `/admin` (the admin index route). Surfaces user growth, role distribution, verification status, and recent-signup counts. Pulls everything from the `user` table — no separate analytics warehouse.

## When It's Used
- Admin lands on `/admin` → loader fetches all four panels in parallel
- Stat cards refresh on route revalidation

## How It Works

Loader runs four tRPC analytics calls in parallel with a 90-day window:

```typescript
const [stats, growthData, roleDistribution, verificationDistribution] =
  await Promise.all([
    context.trpc.analytics.getUserStats(),
    context.trpc.analytics.getUserGrowth({ startDate, endDate }),
    context.trpc.analytics.getRoleDistribution(),
    context.trpc.analytics.getVerificationDistribution(),
  ]);
```

`AnalyticsRepository` runs the queries via `Effect.all([...], { concurrency: "unbounded" })`. Each subquery wraps drizzle in `Effect.tryPromise` mapping failure → `QueryError`.

### Procedures

| Procedure | Returns |
|-----------|---------|
| `getUserStats` | `{ totalUsers, verifiedUsers, bannedUsers, adminUsers, verificationRate }` |
| `getUserGrowth({ startDate, endDate })` | `Array<{ date: string, count: number }>` (grouped by day) |
| `getRoleDistribution` | `Array<{ name: "User" \| "Admin", value: number }>` |
| `getVerificationDistribution` | `Array<{ name: "Verified" \| "Unverified", value: number }>` |
| `getRecentSignupsCount({ days })` | `number` |

### Persistence details
All queries hit the `user` table directly. SQLite-side date bucketing uses `date(created_at / 1000, 'unixepoch')` — `created_at` is `timestamp_ms`, so dividing by 1000 yields seconds for `unixepoch`.

### Testability
- `app/repositories/__tests__/analytics.test.ts` exercises each method against a stubbed `Database`
- Pure SQL pieces (date conversion) are inline — no extracted helper

## Key Files

| File | Role |
|------|------|
| [`app/routes/admin/_index.tsx`](../../app/routes/admin/_index.tsx) | Page (loader + layout) |
| [`app/components/analytics/`](../../app/components/analytics/) | Reusable chart components (`StatCard`, `StatCardGrid`, `TimeSeriesChart`, `DistributionChart`, `InsightsCard`) |
| [`app/routes/admin/components/chart-area-interactive.tsx`](../../app/routes/admin/components/chart-area-interactive.tsx) | Interactive area chart |
| [`app/routes/admin/components/section-cards.tsx`](../../app/routes/admin/components/section-cards.tsx) | Stat cards row |
| [`app/trpc/routes/analytics.ts`](../../app/trpc/routes/analytics.ts) | Analytics procedures |
| [`app/repositories/analytics.ts`](../../app/repositories/analytics.ts) | `AnalyticsRepository` |
| [`app/lib/schemas/analytics.ts`](../../app/lib/schemas/analytics.ts) | `DateRangeInput`, `UserGrowthPoint`, `UserStats`, `DistributionPoint` |

## Dependencies

- Effect services: `Database`
- Repositories: `AnalyticsRepository`
- UI: ShadCN cards + chart primitives

## Tagged Errors

| Error | Where raised | tRPC code |
|-------|--------------|-----------|
| `QueryError` | every analytics method on drizzle failure | `INTERNAL_SERVER_ERROR` |

## Known gaps

- Layout-level auth gate missing (gap #1) — non-admins see the empty page shell
- Time-series query bucketing is inline; if filters expand (per-role growth, etc.), extract a pure SQL-condition builder to mirror `buildUserConditions` in `user.ts`

## Changelog

| Date | Type | Description |
|------|------|-------------|
| 2026-05-07 | brain | First per-feature memory; documented full procedure surface verified from `analytics.ts` |
