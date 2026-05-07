# Routes Layer

React Router v7 routes (UI) + tRPC procedures (API). **Source-of-truth files**: `app/routes/**`, `app/trpc/**`, `app/lib/effect-trpc.ts`.

> Programming model basics: see [`../codebase/effect-ts.md`](../codebase/effect-ts.md). Auth server: [`services.md`](services.md).

## tRPC procedures

Every procedure body is wrapped in `runProcedure(ctx.runtime, Effect.gen(...))`.

```typescript
// app/trpc/routes/widget.ts
import { Effect, Schema } from "effect";
import { adminProcedure, createTRPCRouter } from "..";
import { runProcedure } from "@/lib/effect-trpc";
import { WidgetRepository } from "@/repositories/widget";
import { GetWidgetInput, UpdateWidgetInput } from "@/lib/schemas/widget";

export const widgetRouter = createTRPCRouter({
  getWidget: adminProcedure
    .input(Schema.standardSchemaV1(GetWidgetInput))
    .query(({ ctx, input }) =>
      runProcedure(
        ctx.runtime,
        Effect.gen(function* () {
          const repo = yield* WidgetRepository;
          return yield* repo.getWidget(input);
        })
      )
    ),

  updateWidget: adminProcedure
    .input(Schema.standardSchemaV1(UpdateWidgetInput))
    .mutation(({ ctx, input }) =>
      runProcedure(
        ctx.runtime,
        Effect.gen(function* () {
          const repo = yield* WidgetRepository;
          return yield* repo.updateWidget(input);
        })
      )
    ),
});
```

### Rules

- **`runProcedure`** is the only acceptable wrapper. It runs the Effect on the per-request `ManagedRuntime` and maps tagged errors → `TRPCError`. See [`errors.md`](errors.md).
- **Input adapter**: `Schema.standardSchemaV1(MySchema)` — never Zod, never raw JSON parsing
- **Procedure types**: `publicProcedure`, `protectedProcedure`, `adminProcedure`
  - `protectedProcedure` — `ctx.auth.user` + `ctx.auth.session` guaranteed non-null, throws `UNAUTHORIZED` otherwise
  - `adminProcedure` — extends `protectedProcedure` + checks `user.role === "admin"`, throws `FORBIDDEN` otherwise
- **Domain pre-conditions** (e.g. "can't delete self"): `Effect.fail(new ValidationError(...))` inside the gen — runtime maps to `BAD_REQUEST`
- **Don't** call `runtime.runPromise(...)` directly — use `runProcedure` so errors map correctly
- **Register** the new router in `app/trpc/router.ts`

### Self-check pattern

```typescript
deleteUser: adminProcedure
  .input(Schema.standardSchemaV1(DeleteUserInput))
  .mutation(({ ctx, input }) =>
    runProcedure(
      ctx.runtime,
      Effect.gen(function* () {
        if (input.id === ctx.auth.user.id) {
          return yield* Effect.fail(
            new ValidationError({ entity: "user", message: "Cannot delete self", field: "userId" })
          );
        }
        const repo = yield* UserRepository;
        return yield* repo.deleteUser({ ...input, currentUserId: ctx.auth.user.id });
      })
    )
  ),
```

## React Router routes

File patterns:
- `_layout.tsx` — shared layout wrapper (`<Outlet />` inside)
- `_index.tsx` — index route for a directory
- `resource.$id.tsx` — dynamic param route

### Loader pattern

```typescript
import { Outlet, redirect } from "react-router";
import type { Route } from "./+types/_layout";

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await context.auth.api.getSession({ headers: request.headers });
  if (!session) return redirect("/login");

  const data = await context.trpc.widget.list();
  return { user: session.user, data };
}

export default function Layout({ loaderData }: Route.ComponentProps) {
  const { user, data } = loaderData;
  return <div><nav /><main><Outlet /></main></div>;
}
```

### Rules

- **Auth gate first** — `context.auth.api.getSession({ headers: request.headers })`, redirect on null
- **`context.trpc.*`** for server-side data fetching — same router, no HTTP roundtrip
- **`context.runtime.runPromise(Effect.gen(...))`** for direct Effect calls in loaders (rare; prefer tRPC)
- **Parallel fetches**: `Promise.all([...])`
- **Types**: import `Route` from `./+types/{name}` — `Route.LoaderArgs`, `Route.ComponentProps` are typed
- **Feature flags / analytics**: not wired in this repo. If you add a provider, evaluate it in the loader and surface results via `loaderData` — never trust client state for security gates.

### Parallel fetch

```typescript
const [items, settings, user] = await Promise.all([
  context.trpc.widget.list(),
  context.trpc.settings.get(),
  context.trpc.user.me(),
]);
```

### Client-side data

```typescript
import { api } from "@/trpc/client";

const { data, isLoading, error } = api.widget.list.useQuery();

const utils = api.useUtils();
const mutation = api.widget.update.useMutation({
  onSuccess: () => {
    toast.success("Saved");
    utils.widget.list.invalidate();
  },
  onError: (error) => toast.error(error.message),
});
await mutation.mutateAsync({ id, patch });
```

### Navigation

```typescript
import { useNavigate, Link } from "react-router";
const navigate = useNavigate();
<Link to="/dashboard">Dashboard</Link>
<button onClick={() => navigate("/settings")}>Settings</button>
```

## Auth gating recap

| Surface | Pattern |
|---------|---------|
| Loader | `getSession` then `redirect("/login")` if null |
| tRPC public | `publicProcedure` (no guarantee) |
| tRPC user | `protectedProcedure` (`ctx.auth.user` non-null) |
| tRPC admin | `adminProcedure` (`role === "admin"` non-null) |
| Better Auth API | `app/routes/api/auth.$.ts` — `loader` + `action` both call `auth.handler(request)` |

Server config + Better Auth instance: [`services.md`](services.md). Auth-form UI: [`frontend.md`](frontend.md).

## Anti-patterns

- Building `TRPCError` directly inside a procedure body for domain errors — emit a `Data.TaggedError` and let `tagToTRPC` map it
- Loader that imports a repository directly — go through `context.trpc.*`
- Client `useQuery` without invalidation after a related mutation
- `process.env` anywhere — use `context.cloudflare.env` or `CloudflareEnv` Tag
- Auth check skipped in a loader that returns user-scoped data
- Returning a `Response` from a loader when plain data + `redirect()` would do
