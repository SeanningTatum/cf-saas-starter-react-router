# API Reference

## tRPC routes

Mounted at `/api/trpc/*`. The top-level router (`app/trpc/router.ts`) composes three sub-routers:

| Router | File | Procedures |
|--------|------|------------|
| `user` | `app/trpc/router.ts` | `getUsers` (public), `getUsersProtected`, `deleteUser`, `createWorkflow` |
| `admin` | `app/trpc/routes/admin.ts` | `getUsers`, `getUser`, `updateUser`, `banUser`, `unbanUser`, `deleteUser`, `bulkBanUsers`, `bulkDeleteUsers`, `bulkUpdateUserRoles` |
| `analytics` | `app/trpc/routes/analytics.ts` | `getUserStats`, `getUserGrowth`, `getRoleDistribution`, `getVerificationDistribution`, `getRecentSignupsCount` |

Read the route files directly for current input schemas — they're authoritative.

### Example procedure (current pattern)

```typescript
// app/trpc/routes/admin.ts
export const adminRouter = createTRPCRouter({
  getUsers: adminProcedure
    .input(Schema.standardSchemaV1(GetUsersInput))
    .query(({ ctx, input }) =>
      runProcedure(
        ctx.runtime,
        Effect.gen(function* () {
          const repo = yield* UserRepository;
          return yield* repo.getUsers(input);
        })
      )
    ),
});
```

Rules:
- **Body always wrapped in `runProcedure(ctx.runtime, Effect.gen(...))`.** It runs the Effect on the per-request `ManagedRuntime` and converts tagged errors → `TRPCError` via `tagToTRPC`.
- **Input via Effect Schema:** `Schema.standardSchemaV1(MySchema)`. Decode failures surface to clients as `TRPCError({ code: "BAD_REQUEST" })` with structured `data.schemaError` (formatted by `ParseResult.ArrayFormatter`).
- **Yield repos** (`yield* WidgetRepository`) — never call repo methods as plain functions.
- **Domain pre-conditions:** `Effect.fail(new ValidationError(...))` inside the gen — `tagToTRPC` maps to `BAD_REQUEST`.

### Server-side calls (loaders)

```typescript
// app/routes/admin/users.tsx
export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await context.auth.api.getSession({ headers: request.headers });
  if (!session) return redirect("/login");

  const result = await context.trpc.admin.getUsers({ page: 0, limit: 50 });
  return { users: result.users };
}
```

`context.trpc` is a typed tRPC caller created via `createCallerFactory(appRouter)` — same router, no HTTP roundtrip.

### Client-side calls

> Note: real admin pages (`/admin/users`) are loader-driven, not client-driven. The pattern below is the **generic React-Query shape** for any future client-side procedure.

```typescript
import { api } from "@/trpc/client";

// query example (generic shape — no real call site uses this for admin today)
const { data, isLoading } = api.user.getUsers.useQuery();

// mutation + cache invalidation
const utils = api.useUtils();
const mutation = api.admin.updateUser.useMutation({
  onSuccess: () => { toast.success("Saved"); utils.admin.getUsers.invalidate(); },
  onError: (e) => toast.error(e.message),
});
```

---

## Procedure types

Defined in `app/trpc/index.ts`. All three include the `timingMiddleware` that logs procedure duration via `loggers.trpc`.

| Procedure | Requirement | Context guarantees |
|-----------|-------------|--------------------|
| `publicProcedure` | None | `ctx.auth` may be `null` |
| `protectedProcedure` | Logged in | `ctx.auth.user` and `ctx.auth.session` non-null |
| `adminProcedure` | Admin role | `ctx.auth.user.role === "admin"` non-null |

`protectedProcedure` and `adminProcedure` middleware throws `TRPCError` directly for auth failures — that is intentional **control flow** for the unauthenticated/forbidden case, not a domain error. Tagged errors are reserved for repository / domain failures.

---

## Page route table

From [`app/routes.ts`](../../app/routes.ts):

| Path | File | Notes |
|------|------|-------|
| `/api/trpc/*` | `routes/api/trpc.$.ts` | tRPC HTTP handler |
| `/api/auth/*` | `routes/api/auth.$.ts` | Better Auth handler |
| `/api/upload-file` | `routes/api/upload-file.ts` | R2 upload (⚠ no auth) |
| `/` | `routes/home.tsx` | Public marketing page |
| `/:lng` | same | Locale-prefixed variant |
| `/login`, `/sign-up` | `routes/authentication/{login,sign-up}.tsx` | Redirect to `/dashboard` if session present. `:lng` variants exist. |
| `/dashboard`, `/dashboard/_index` | `routes/dashboard/{_layout,_index}.tsx` | Layout loader gates: redirects to `/login` if no session |
| `/admin` | `routes/admin/_layout.tsx` + `_index.tsx` | ⚠ **Layout has no auth gate today.** Index is the analytics dashboard |
| `/admin/users` | `routes/admin/users.tsx` | User management |
| `/admin/kitchen-sink` | `routes/admin/kitchen-sink.tsx` | Component showcase |

Locale prefixes: only `/`, `/login`, `/sign-up` accept the `/:lng/` variant. `/dashboard` and `/admin` are not locale-prefixed.

## Auth endpoints (Better Auth)

Mounted at `/api/auth/*` via the catch-all route `app/routes/api/auth.$.ts`. Both `loader` and `action` delegate to `auth.handler(request)`.

```
POST /api/auth/sign-up/email     { email, password, name }
POST /api/auth/sign-in/email     { email, password }
POST /api/auth/sign-out
GET  /api/auth/get-session       (cookie)
```

Client SDK:

```typescript
import { authClient } from "@/auth/client";

await authClient.signUp.email({ email, password, name });
await authClient.signIn.email({ email, password });
await authClient.signOut();
const { data: session } = authClient.useSession();
```

---

## File upload

```
POST /api/upload-file
Content-Type: multipart/form-data
Body: FormData with 'file' field

Success → 200 { success: true, key: string }    // key = "uploads/<timestamp>-<uuid>"
Failure → 400 "No file provided"
        | 500 <Cause.pretty(...)>
```

Implemented at [`app/routes/api/upload-file.ts`](../../app/routes/api/upload-file.ts). Backed by `BucketRepository.upload` over the `BUCKET` (R2) binding. The response returns the **R2 object key** — there is no signed-URL or public-URL construction today.

```typescript
const formData = new FormData();
formData.append("file", file);
const res = await fetch("/api/upload-file", { method: "POST", body: formData });
const { key } = await res.json();
```

> ⚠ This route is **not auth-gated** and the repository performs **no file-type or size validation**. See [`../high-level-architecture/security.md`](../high-level-architecture/security.md) gaps #2–#4.

---

## Error responses

### tRPC error envelope

```typescript
{
  error: {
    message: string;
    code: "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "BAD_REQUEST" | "INTERNAL_SERVER_ERROR" | "BAD_GATEWAY";
    data?: {
      schemaError?: Array<{ path: ReadonlyArray<unknown>; message: string }>;
    };
  };
}
```

### Tagged error → TRPC code mapping

Single mapping point: `tagToTRPC` in `app/lib/effect-trpc.ts`.

| Tagged error | TRPC code |
|--------------|-----------|
| `NotFoundError`, `BucketNotFoundError` | `NOT_FOUND` |
| `ValidationError`, `BucketValidationError` | `BAD_REQUEST` |
| `CreationError`, `UpdateError`, `DeletionError`, `QueryError`, `ConfigurationError`, `Bucket{Binding,Upload,Get,Delete,List}Error`, `WorkflowTriggerError` | `INTERNAL_SERVER_ERROR` |
| `ExternalServiceError` | `BAD_GATEWAY` |

To add a new tagged error: define in `app/models/errors/`, add a `case` to `toTRPC` in `app/lib/effect-trpc.ts`, add a unit test in `app/lib/__tests__/effect-trpc.test.ts`. See [`../rules/errors.md`](../rules/errors.md).

---

## Context object

Created in `app/trpc/index.ts` as `createTRPCContext({ headers, runtime })`:

```typescript
type Context = {
  headers: Headers;
  runtime: AppRuntime;          // ManagedRuntime composing all Layers
  auth: { session, user } | null;
};
```

After `protectedProcedure`, `ctx.auth` is non-null. After `adminProcedure`, `ctx.auth.user.role === "admin"`.

The React Router `AppLoadContext` (declared in `workers/app.ts`) is separate:

```typescript
interface AppLoadContext {
  cloudflare: { env: Env; ctx: ExecutionContext };
  trpc: ReturnType<typeof createCaller>;
  auth: Auth;                   // Better Auth instance (raw)
  runtime: AppRuntime;
}
```

There is **no** `context.db`, `context.posthog`, or `context.stripe`. Bindings come from `context.cloudflare.env`. Database goes through repositories via `context.trpc.*` or `context.runtime.runPromise(Effect.gen(...))`.
