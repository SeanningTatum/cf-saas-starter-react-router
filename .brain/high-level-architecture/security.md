# Security Model

## Authentication flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│ Better Auth │────▶│   Verify    │────▶│   Create    │
│   Request   │     │   Handler   │     │ Credentials │     │   Session   │
└─────────────┘     └─────────────┘     └─────────────┘     └──────┬──────┘
                                                                   │
                                                                   ▼
                                                            ┌─────────────┐
                                                            │ Set Cookie  │
                                                            │ (httpOnly)  │
                                                            └─────────────┘
```

Better Auth is configured per request in `workers/app.ts` via `createAuth(env.DATABASE, env.BETTER_AUTH_SECRET, origin)`. Email/password is the only enabled credential method (`emailAndPassword: { enabled: true }`); the `admin` plugin is loaded.

## Session management

### Session storage
- Persisted in **D1** `session` table by Better Auth's drizzle adapter (not KV — there is no KV binding)
- Session token in httpOnly cookie
- `session.ipAddress` + `session.userAgent` captured for audit
- `session.impersonatedBy` is the admin user id when impersonating

### Session validation in loaders

```typescript
const session = await context.auth.api.getSession({ headers: request.headers });
if (!session) return redirect("/login");
```

Inside an Effect program, yield the `AuthApi` service Tag and call `api.getSession`:

```typescript
const { api } = yield* AuthApi;
const session = yield* Effect.promise(() => api.getSession({ headers: request.headers }));
```

### Impersonation
```typescript
if (session.session.impersonatedBy) {
  // currently impersonating — admin user id is the value
}
```

---

## Authorization layers

### Layer 1: route protection (loaders)

Canonical pattern (used by [`app/routes/dashboard/_layout.tsx`](../../app/routes/dashboard/_layout.tsx)):

```typescript
export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await context.auth.api.getSession({ headers: request.headers });
  if (!session) return redirect("/login");
  return { user: session.user };
}
```

Auth pages (`/login`, `/sign-up`) flip the check — redirect to `/dashboard` if a session already exists. After successful sign-in / sign-up the form components `navigate("/dashboard")`.

> ⚠ **Current gap (verified 2026-05-07):** [`app/routes/admin/_layout.tsx`](../../app/routes/admin/_layout.tsx) has **no loader** — it does not gate on session or admin role. Admin pages rely on `adminProcedure` middleware throwing `UNAUTHORIZED` / `FORBIDDEN` from any tRPC call inside the loader (e.g. `context.trpc.admin.getUsers`), which surfaces as a 500-page rather than a redirect. To harden, add a loader to `_layout.tsx` that calls `getSession`, checks `role === "admin"`, and redirects to `/login` or `/` accordingly.

### Layer 2: tRPC procedures

`app/trpc/index.ts` defines three procedure types. The middleware throws `TRPCError` directly because procedure-level auth is **control flow**, not domain error — the tagged-error model is for repository / domain failures.

```typescript
export const protectedProcedure = t.procedure
  .use(timingMiddleware)
  .use(({ ctx, next }) => {
    if (!ctx.auth) throw new TRPCError({ code: "UNAUTHORIZED" });
    return next({
      ctx: { ...ctx, auth: { session: ctx.auth.session!, user: ctx.auth.user! } },
    });
  });

export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.auth.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
  return next();
});
```

After `protectedProcedure`, `ctx.auth.user` and `ctx.auth.session` are guaranteed non-null. After `adminProcedure`, `ctx.auth.user.role === "admin"`.

### Layer 3: repository validation

Repositories receive validated input (Effect Schema decoded at the procedure boundary) and **never** perform auth checks. They are framework-agnostic `Effect.Service` classes:

```typescript
// app/repositories/user.ts
export class UserRepository extends Effect.Service<UserRepository>()(
  "app/UserRepository",
  {
    effect: Effect.gen(function* () {
      const { db } = yield* Database;

      const updateUser = (input: UpdateUserInput & { currentUserId: string }) =>
        Effect.gen(function* () {
          // validation / pre-conditions emit Data.TaggedError
          // db ops wrapped in tryQuery / tryUpdate
        });

      return { updateUser } as const;
    }),
  }
) {}
```

Identity (`currentUserId`) and other "who is calling" data must be passed as input — repositories never read `ctx`.

---

## Role-Based Access Control (RBAC)

### Roles

The `user.role` column is a literal enum: `"user" | "admin"` (default `"user"`). Defined in [`app/db/schema.ts`](../../app/db/schema.ts):

```typescript
role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
```

| Role | Capabilities |
|------|-------------|
| `user` | Access protected routes, own data |
| `admin` | Plus admin routes, user management, impersonation |

### Role check pattern

```typescript
// loader
if (session.user.role !== "admin") return redirect("/");

// tRPC — already enforced by adminProcedure middleware
adminProcedure.query(({ ctx }) => /* ctx.auth.user.role === "admin" */)
```

---

## Ban system

Ban fields on `user`:

```typescript
banned: integer("banned", { mode: "boolean" }).default(false),
banReason: text("ban_reason"),
banExpires: integer("ban_expires", { mode: "timestamp_ms" }),
```

Better Auth's `admin` plugin handles ban enforcement at login. `banExpires` is a `timestamp_ms` column (`null` = permanent ban).

```
Login → fetch user → banned? → banExpires expired?
              │                       │
              ▼                       ▼
         Block + reason           Allow login
```

---

## Input validation

### Server-side (tRPC) — Effect Schema, **no Zod**

```typescript
import { Schema } from "effect";

export const UpdateUserInput = Schema.Struct({
  userId: Schema.String,
  data: Schema.Struct({
    email: Schema.optional(Schema.String.pipe(Schema.pattern(/^[^@\s]+@[^@\s]+\.[^@\s]+$/))),
    role: Schema.optional(Schema.Literal("user", "admin")),
  }),
});

updateUser: adminProcedure
  .input(Schema.standardSchemaV1(UpdateUserInput))
  .mutation(({ ctx, input }) => runProcedure(ctx.runtime, Effect.gen(function* () { /* ... */ })))
```

Schema decode failures surface to the client as `TRPCError({ code: "BAD_REQUEST" })` with structured `data.schemaError` (formatted by `ParseResult.ArrayFormatter` in `app/trpc/index.ts`).

### Client-side
React Hook Form via `effectResolver(MySchema)` from `@/lib/effect-form`. Client validation is a UX layer, not a security boundary.

### Domain pre-conditions
Inside `Effect.gen`, fail with a tagged error — `tagToTRPC` maps to HTTP code:

```typescript
if (input.id === ctx.auth.user.id) {
  return yield* Effect.fail(
    new ValidationError({ entity: "user", message: "Cannot delete self", field: "userId" })
  );
}
```

### Database-level
Drizzle column constraints (`notNull`, `unique`, FK with `onDelete: "cascade"`).

---

## Secrets management

### Development
`.dev.vars` (gitignored) — read by Wrangler dev:

```
BETTER_AUTH_SECRET=...
```

### Production
```bash
bunx wrangler secret put BETTER_AUTH_SECRET
```

### Access pattern
**Never `process.env`.** Three valid paths:

```typescript
// A. inside Effect — yield the Tag
const env = yield* CloudflareEnv;
env.BETTER_AUTH_SECRET;

// B. loader / action
context.cloudflare.env.BETTER_AUTH_SECRET;

// C. typed Env
import type { Env } from "../worker-configuration";
```

**Never:**
- Commit secrets to git
- Log secrets
- Expose `BETTER_AUTH_SECRET` to the client bundle
- Trust client-side auth state for authz decisions

---

## Security headers

Cloudflare Workers handles HTTPS enforcement and DDoS protection at the edge. Application-level headers (CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`) are **not** currently set in this project — add via response middleware in `workers/app.ts` if required for production hardening.

---

## Known gaps (audit, 2026-05-07)

These are real holes in the current code. Listed here so future work can close them deliberately. None are CHANGELOG entries — they are outstanding TODOs.

| # | Surface | Issue | Suggested fix |
|---|---------|-------|---------------|
| 1 | `app/routes/admin/_layout.tsx` | No auth/role gate at the layout loader. Pages rely on `adminProcedure` to throw on tRPC calls. | Add a loader: `getSession`; redirect `/login` if absent, `/` if not admin. |
| 2 | `app/routes/api/upload-file.ts` | `POST /api/upload-file` performs no auth check before writing to R2. Anyone with the URL can upload. | Add a `getSession` check (or move behind a `protectedProcedure` style guard). |
| 3 | `app/repositories/bucket.ts` `upload` | Accepts any file type and any size — no `BucketValidationError` raised. | Validate `file.type` against an allow-list and `file.size` against a constant before `bucket.put`. |
| 4 | `app/routes/api/upload-file.ts` response | Returns `{ success, key }` — clients can't construct a public URL without the bucket's public hostname. | Either return a signed URL or document a stable public-bucket prefix. |
| 5 | Workers response | No CSP / `X-Frame-Options` / `Referrer-Policy` headers set. | Add response middleware in `workers/app.ts`. |
