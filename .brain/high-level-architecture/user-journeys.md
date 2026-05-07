# User Journeys

Verified against current code (2026-05-07). Auth pages live at root (no locale prefix); after auth, users land on `/dashboard`. `/admin/*` is reachable but currently has no layout-level auth gate (see [`security.md`](security.md) gap #1).

## Authentication flows

### Sign Up (new user)

```
User → /sign-up                                       (loader: redirect /dashboard if session)
     → SignupForm submits                             (Effect Schema validation client-side)
     → authClient.signUp.email({ email, password, name })
     → Better Auth handler at /api/auth/sign-up/email
     → Inserts user + account, creates session, sets httpOnly cookie
     → On success, form calls navigate("/dashboard")
```

Key files:
- [`app/routes/authentication/sign-up.tsx`](../../app/routes/authentication/sign-up.tsx)
- [`app/routes/authentication/components/signup-form.tsx`](../../app/routes/authentication/components/signup-form.tsx)
- [`app/auth/server.ts`](../../app/auth/server.ts), [`app/auth/client.ts`](../../app/auth/client.ts)
- [`app/lib/schemas/auth.ts`](../../app/lib/schemas/auth.ts) — `SignupSchema` (with confirm-password filter)

### Login (existing user)

```
User → /login                                         (loader: redirect /dashboard if session)
     → LoginForm submits
     → authClient.signIn.email({ email, password })
     → Better Auth handler verifies, checks ban (admin plugin), creates session
     → On success, form calls navigate("/dashboard")
```

A banned user fails at the Better Auth layer with the ban reason in the error response — the form surfaces it inline.

### Logout

```
User clicks sign-out → authClient.signOut() → /api/auth/sign-out → cookie cleared → client redirects to /login
```

## Dashboard journey

```
User → /dashboard                                     (loader: getSession → redirect /login if absent)
     → /dashboard/_index.tsx                          (placeholder content today)
```

Layout is gated at [`app/routes/dashboard/_layout.tsx`](../../app/routes/dashboard/_layout.tsx).

## Admin journeys

> ⚠ The admin layout currently has no auth gate (see `security.md` gap #1). Data is still gated because every `/admin/*` page calls a `context.trpc.admin.*` method, which goes through `adminProcedure` middleware (`UNAUTHORIZED` if no session, `FORBIDDEN` if `role !== "admin"`). UI shell still renders — only the data fetch fails.

### User management

```
Admin → /admin/users
      → loader: parses ?page, ?pageSize, ?search, ?role, ?status
      → context.trpc.admin.getUsers({ page, limit, search, role, status })
      → Returns { users, total, page, pageSize, ... }
      → Renders UserDataTable with row-level actions
        ├─ Ban (sets banned=true + reason + optional banExpires)
        ├─ Unban (clears ban fields)
        ├─ Update role
        ├─ Bulk ban / delete / role-update
        └─ Impersonate (admin plugin)
```

Key files:
- [`app/routes/admin/users.tsx`](../../app/routes/admin/users.tsx)
- [`app/routes/admin/components/user-data-table.tsx`](../../app/routes/admin/components/user-data-table.tsx)
- [`app/trpc/routes/admin.ts`](../../app/trpc/routes/admin.ts) — full procedure surface (`getUsers`, `getUser`, `updateUser`, `banUser`, `unbanUser`, `deleteUser`, `bulkBanUsers`, `bulkDeleteUsers`, `bulkUpdateUserRoles`)
- [`app/repositories/user.ts`](../../app/repositories/user.ts)

### Admin dashboard (analytics)

```
Admin → /admin (index)
      → loader: Promise.all of analytics.* tRPC calls (90-day window)
      → Stats cards (total users, verified, banned, admins, verification rate)
      → Time-series chart (signups over time)
      → Distribution charts (role, verification)
```

Key files:
- [`app/routes/admin/_index.tsx`](../../app/routes/admin/_index.tsx)
- [`app/repositories/analytics.ts`](../../app/repositories/analytics.ts)
- [`app/components/analytics/`](../../app/components/analytics/)

## File upload journey

```
User → File-upload component → POST /api/upload-file (multipart/form-data, field "file")
     → action handler: BucketRepository.upload(file)
     → R2 put under uploads/${Date.now()}-${crypto.randomUUID()}
     → Response: { success: true, key }
```

⚠ See `security.md` gaps #2–#4: no auth gate on this route, no file-type/size validation, no public-URL construction in the response.

Key files:
- [`app/components/file-upload.tsx`](../../app/components/file-upload.tsx)
- [`app/routes/api/upload-file.ts`](../../app/routes/api/upload-file.ts)
- [`app/repositories/bucket.ts`](../../app/repositories/bucket.ts)

## Role / route map

```
Public                Protected (session)         Admin (role="admin")
─────────             ──────────────────          ────────────────────
/                     /dashboard/*                /admin/*  ← layout gate currently missing;
/login                                              data-level enforcement via adminProcedure
/sign-up
/api/auth/*           /api/upload-file ⚠ no auth check
/api/trpc/*  (mixed — per procedure)
```

## Error states

### Banned user login attempt
Better Auth's `admin` plugin rejects the sign-in. `authClient.signIn.email` returns an `error` object; the form surfaces `error.message` (which includes the ban reason if Better Auth provides it).

### Session expired
Loader's `getSession` returns `null`. Dashboard layout redirects to `/login`. Admin layout doesn't redirect today — see gap #1.

### Unauthorized admin tRPC call
`adminProcedure` throws `TRPCError({ code: "UNAUTHORIZED" })` if no session, `TRPCError({ code: "FORBIDDEN" })` if `role !== "admin"`. In a loader, this surfaces as a thrown error → React Router error boundary.
