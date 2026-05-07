# Feature: Admin Dashboard

_Last updated: 2026-05-07_

## Purpose
Admin-only area for user management and analytics. Mounted under `/admin/*`. Protection is currently **data-side** (`adminProcedure` middleware on every tRPC call) — the layout itself has no loader-level auth gate.

## When It's Used
- Admin user navigates to `/admin` (analytics index), `/admin/users` (user mgmt), `/admin/kitchen-sink` (component showcase)
- Cross-feature: every admin page issues at least one `context.trpc.admin.*` or `context.trpc.analytics.*` call from its loader

## How It Works

`/admin/_layout.tsx` is a thin SidebarProvider wrapper with `<Outlet />`. **No `loader` is exported** — anyone can hit the URL; the page renders the shell. Data fetched via `context.trpc.admin.*` triggers `adminProcedure` middleware which throws `UNAUTHORIZED` (no session) or `FORBIDDEN` (`role !== "admin"`), surfacing as a thrown error from the loader.

`/admin/users` parses query string (`page`, `pageSize`, `search`, `role`, `status`), calls `context.trpc.admin.getUsers`, and renders `UserDataTable` with row-level + bulk actions.

### Persistence details
- All admin operations target the `user` table
- Bulk operations validate "self-protection" (`isProtectedUser`) via the `currentUserId` parameter passed from the procedure
- `banExpires` is `timestamp_ms`, `null` = permanent

### Testability
- `app/repositories/__tests__/user.test.ts` — repo unit tests via `makeTestDatabase` stubs (NotFoundError, validation, bulk paths)
- Pure helpers `isProtectedUser` and `buildUserConditions` exported top-level for direct test access
- No e2e for admin flows yet (gap)

## Key Files

| File | Role |
|------|------|
| [`app/routes/admin/_layout.tsx`](../../app/routes/admin/_layout.tsx) | Sidebar shell — ⚠ no auth loader |
| [`app/routes/admin/_index.tsx`](../../app/routes/admin/_index.tsx) | Analytics dashboard (see `analytics.md`) |
| [`app/routes/admin/users.tsx`](../../app/routes/admin/users.tsx) | User management page |
| [`app/routes/admin/components/user-data-table.tsx`](../../app/routes/admin/components/user-data-table.tsx) | Data table + actions |
| [`app/routes/admin/kitchen-sink.tsx`](../../app/routes/admin/kitchen-sink.tsx) | Component showcase |
| [`app/routes/admin/layout/`](../../app/routes/admin/layout/) | Sidebar + site header |
| [`app/trpc/routes/admin.ts`](../../app/trpc/routes/admin.ts) | `getUsers`, `getUser`, `updateUser`, `banUser`, `unbanUser`, `deleteUser`, `bulkBanUsers`, `bulkDeleteUsers`, `bulkUpdateUserRoles` |
| [`app/repositories/user.ts`](../../app/repositories/user.ts) | `UserRepository` |
| [`app/lib/schemas/user.ts`](../../app/lib/schemas/user.ts) | All user input/output schemas |

## Dependencies

- Effect services: `Database`, via `UserRepository`
- Repositories: `UserRepository`
- Procedure middleware: `adminProcedure` (`app/trpc/index.ts`)
- UI: ShadCN `Sidebar`, `Table`, `Button`, `Dialog`, `Badge`, `Input`

## Tagged Errors

| Error | Where raised | tRPC code |
|-------|--------------|-----------|
| `NotFoundError` | `UserRepository.getUser` / `updateUser` / `banUser` / `unbanUser` / `deleteUser` | `NOT_FOUND` |
| `ValidationError` | `UserRepository.deleteUser` self-protection; `UserRepository.banUser` protected user; bulk validations | `BAD_REQUEST` |
| `UpdateError`, `DeletionError`, `QueryError` | DB call failures | `INTERNAL_SERVER_ERROR` |

## Known gaps

- Layout-level auth gate missing — see [`../high-level-architecture/security.md`](../high-level-architecture/security.md) gap #1
- No Playwright e2e for admin user-mgmt flows

## Changelog

| Date | Type | Description |
|------|------|-------------|
| 2026-05-07 | brain | First per-feature memory |
