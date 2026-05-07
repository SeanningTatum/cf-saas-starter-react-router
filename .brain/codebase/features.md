# Features (overview)

Quick map of what's shipped. **Detailed per-feature memory lives in [`../features/<slug>.md`](../features/index.md)** — five files exist today; copy [`../features/_TEMPLATE.md`](../features/_TEMPLATE.md) when adding a new one.

| Feature | Per-feature doc |
|---------|-----------------|
| Authentication | [`../features/authentication.md`](../features/authentication.md) |
| Admin Dashboard | [`../features/admin-dashboard.md`](../features/admin-dashboard.md) |
| File Upload | [`../features/file-upload.md`](../features/file-upload.md) |
| Analytics | [`../features/analytics.md`](../features/analytics.md) |

This file is the high-level map. Each per-feature doc holds the detailed runtime flow, dependencies, tagged errors, and changelog.

## Authentication

Email/password via Better Auth + drizzle adapter. Sessions persisted in D1 `session` table. `admin` role + ban fields on `user`. Admin impersonation via `session.impersonatedBy`. Successful sign-up / sign-in lands on `/dashboard`.

Key files: `app/auth/{server,client}.ts`, `app/services/auth.ts`, `app/routes/authentication/{login,sign-up}.tsx`, `app/routes/api/auth.$.ts`. See [`../high-level-architecture/security.md`](../high-level-architecture/security.md).

## Admin Dashboard

`/admin` area. User listing + bulk actions (ban/unban, role change, delete) wired through `adminProcedure`. Live data via `context.trpc.admin.*` in loaders. Admin layout currently has **no auth gate at the loader level** — protection is enforced data-side by `adminProcedure` middleware.

Key files: `app/routes/admin/{_layout,users,_index}.tsx`, `app/routes/admin/components/`, `app/trpc/routes/admin.ts`, `app/repositories/user.ts`.

## File Upload

`POST /api/upload-file` writes to R2 via `BucketRepository.upload`. Returns `{ success: true, key }` (no public URL constructed). Object keyed `uploads/<timestamp>-<uuid>`.

⚠ Route is unauthenticated; repo performs no file-type/size validation. See [`../high-level-architecture/security.md`](../high-level-architecture/security.md) gaps #2–#4.

Key files: `app/components/file-upload.tsx`, `app/routes/api/upload-file.ts`, `app/repositories/bucket.ts`, `app/services/bucket.ts`. Tagged errors: `BucketUploadError`, `BucketGetError`, `BucketDeleteError`, `BucketListError`, `BucketBindingError`, `BucketValidationError`, `BucketNotFoundError`.

## Analytics

Interactive admin dashboard at `/admin`. 90-day window for time-series; stat cards for totals + verification rate + role/verification distribution.

Key files: `app/routes/admin/_index.tsx`, `app/routes/admin/components/{chart-area-interactive,section-cards}.tsx`, `app/components/analytics/`, `app/trpc/routes/analytics.ts`, `app/repositories/analytics.ts`.

## i18n + dark mode

`/:lng/` URL prefix on public/auth routes; `/dashboard` and `/admin` are client-side-only i18n. Dark mode via CSS variables in `app/app.css`. Only English ships today (`supportedLngs = ["en"]`). See [`i18n.md`](i18n.md) and [`../rules/frontend.md`](../rules/frontend.md).

## Promoting a new feature

When you start substantive work on a new feature, copy [`../features/_TEMPLATE.md`](../features/_TEMPLATE.md) to `../features/<slug>.md`, fill it out, register a row in [`../features/index.md`](../features/index.md), and add a row to the table at the top of this file.
