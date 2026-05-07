# Feature: Authentication

_Last updated: 2026-05-07_

## Purpose
Email/password authentication with role-based access control (`user` / `admin`) and a ban system. Powered by [Better Auth](https://better-auth.com) using the `admin` plugin and a Drizzle adapter against D1.

## When It's Used
- Public visitor opens `/sign-up` or `/login`
- Loader on protected routes (`/dashboard/*`, intended for `/admin/*`) calls `getSession`
- Every tRPC procedure resolves `ctx.auth` from the cookie
- Admin actions (ban / unban / impersonate / role change) on `/admin/users`

## How It Works

Better Auth is built **per request** in [`workers/app.ts`](../../workers/app.ts):

```typescript
const auth = createAuth(env.DATABASE, env.BETTER_AUTH_SECRET, new URL(request.url).origin);
const runtime = makeAppRuntime(env, auth);
```

The `AuthApi` Effect Tag wraps the running instance so repos / procedures can resolve sessions inside `Effect.gen`:

```typescript
const { api } = yield* AuthApi;
const session = yield* Effect.promise(() => api.getSession({ headers }));
```

[`createTRPCContext`](../../app/trpc/index.ts) calls `api.getSession` once per request and exposes `ctx.auth = { session, user } | null`. `protectedProcedure` and `adminProcedure` enforce non-null and role respectively, throwing `TRPCError` directly (control-flow, not domain error).

Form components (`signup-form.tsx`, `login-form.tsx`) call `authClient.signUp.email` / `authClient.signIn.email` from the browser; on success they `navigate("/dashboard")`.

### Persistence details
- D1 tables (Better Auth's drizzle schema): `user`, `session`, `account`, `verification` — see [`app/db/schema.ts`](../../app/db/schema.ts)
- `user.role`: `"user" | "admin"`, default `"user"`
- `user.banned`, `banReason`, `banExpires` (timestamp_ms, null = permanent)
- Session token in httpOnly cookie; `session.ipAddress`, `session.userAgent` captured for audit
- `session.impersonatedBy` is the admin user id during impersonation

### Testability
- `app/lib/schemas/auth.ts` (`SignupSchema`, `LoginSchema`, `Email`, `Password`, `NonEmptyString`) covered by `app/lib/schemas/__tests__/auth.test.ts`
- Better Auth itself is exercised end-to-end via Playwright with `admin@test.local` / `TestAdmin123!` (see [`../rules/library.md`](../rules/library.md))
- No unit test for `createAuth` itself — relies on Better Auth's own tests

## Key Files

| File | Role |
|------|------|
| [`app/auth/server.ts`](../../app/auth/server.ts) | `createAuth(database, secret, baseURL?)` factory |
| [`app/auth/client.ts`](../../app/auth/client.ts) | `authClient` (`signUp`, `signIn`, `signOut`, `useSession`) |
| [`app/services/auth.ts`](../../app/services/auth.ts) | `AuthApi` Effect Tag + `AuthApiLive` Layer |
| [`app/services/session.ts`](../../app/services/session.ts) | `Session` Tag (per-request, ad-hoc) |
| [`app/trpc/index.ts`](../../app/trpc/index.ts) | `createTRPCContext`, `publicProcedure`, `protectedProcedure`, `adminProcedure` |
| [`app/lib/schemas/auth.ts`](../../app/lib/schemas/auth.ts) | `LoginSchema`, `SignupSchema`, `Email`, `Password` |
| [`app/routes/authentication/login.tsx`](../../app/routes/authentication/login.tsx) | Login page |
| [`app/routes/authentication/sign-up.tsx`](../../app/routes/authentication/sign-up.tsx) | Sign-up page |
| [`app/routes/authentication/components/login-form.tsx`](../../app/routes/authentication/components/login-form.tsx) | Login form (RHF + `effectResolver(LoginSchema)`) |
| [`app/routes/authentication/components/signup-form.tsx`](../../app/routes/authentication/components/signup-form.tsx) | Sign-up form |
| [`app/routes/api/auth.$.ts`](../../app/routes/api/auth.$.ts) | `/api/auth/*` catch-all delegating to `auth.handler` |
| [`app/routes/dashboard/_layout.tsx`](../../app/routes/dashboard/_layout.tsx) | Canonical loader-level auth gate |

## Dependencies

- Effect services consumed: `AuthApi`, `CloudflareEnv`
- Repositories called: `UserRepository` (admin user-management procedures)
- External SDKs: `better-auth`, `better-auth/adapters/drizzle`, `better-auth/plugins` (`admin`)
- Required env: `BETTER_AUTH_SECRET` (set via `bunx wrangler secret put BETTER_AUTH_SECRET`)
- UI primitives: ShadCN `Form`, `Input`, `Button`, `Card`

## Tagged Errors

Auth-surface errors only. User-management errors raised through admin procedures (`NotFoundError`, `UpdateError`, `DeletionError`, `QueryError`, `ValidationError` from `UserRepository`) are documented in [`admin-dashboard.md`](admin-dashboard.md).

| Error | Where raised | tRPC code |
|-------|--------------|-----------|
| `ExternalServiceError` | `AuthApiLive` if `createAuth` throws | `BAD_GATEWAY` |
| `ConfigurationError` | `DatabaseLive` if `env.DATABASE` is undefined (auth depends on D1) | `INTERNAL_SERVER_ERROR` |
| `ValidationError` | `user.deleteUser` self-check (`Cannot delete self`) | `BAD_REQUEST` |

Procedure-level auth failures throw `TRPCError({ code: "UNAUTHORIZED" \| "FORBIDDEN" })` directly from `protectedProcedure` / `adminProcedure` middleware — these are not tagged errors by design (control flow vs. domain error).

## Known gaps

See [`../high-level-architecture/security.md`](../high-level-architecture/security.md) "Known gaps". Specifically: `/admin/_layout.tsx` has no loader gate today.

## Changelog

| Date | Type | Description |
|------|------|-------------|
| 2026-05-07 | brain | First per-feature memory — promoted from `codebase/features.md` overview |
| 2026-05-07 | refactor | `AuthApi` migrated to Effect Tag; tRPC context resolves session via `runtime.runPromise` |
