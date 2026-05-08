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

### Procedure-level error transformation

Default flow: repo emits tagged error → falls through `runProcedure` → `tagToTRPC` produces a generic HTTP status + bland message ("Failed to update user"). For **simple CRUD procedures** that's correct — don't add ceremony.

For **complex procedures** (multi-step, third-party side effects, bulk ops, transient failures, domain-specific recovery), transform the Effect at the procedure layer **before** `runProcedure`. Use these patterns:

| Pattern | Use when | Example |
|---------|----------|---------|
| `Effect.catchTag("X", e => Effect.fail(new Y(...)))` | Re-map a single tag with richer context (e.g. `NotFoundError` → `ValidationError` "already deleted") | re-mapping below |
| `Effect.catchTags({ X: ..., Y: ... })` | Re-map several tags at once | mixed transient + domain |
| `Effect.retry({ schedule: Schedule.exponential("100 millis"), times: 3 })` | Transient infra failure (D1 timeout, R2 slow) | wrap a single repo call |
| `Effect.tap(value => Effect.logInfo("user.updated").pipe(Effect.annotateLogs({ ...value })))` | Structured success log with input/output context | audit trail (see [services.md "Logging"](services.md#logging--effect-logger-vs-imperative-loggersx)) |
| `Effect.tapErrorTag("X", e => Effect.logWarning(...))` | Log a specific failure shape differently | domain warnings vs infra errors |
| `Effect.partition(items, fn, { concurrency: N })` | Bulk op where partial success is acceptable | per-item bulk ban |
| `Effect.timeout("5 seconds")` | Hard SLA on a slow procedure | external API call |

Example — complex procedure that re-maps, retries, and logs:

```typescript
deleteUser: adminProcedure
  .input(Schema.standardSchemaV1(DeleteUserInput))
  .mutation(({ ctx, input }) =>
    runProcedure(
      ctx.runtime,
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        return yield* repo.deleteUser({ ...input, currentUserId: ctx.auth.user.id });
      }).pipe(
        // Transient DB hiccup — retry before surfacing
        Effect.retry({ times: 2, schedule: Schedule.exponential("100 millis") }),
        // Re-map "missing" → 400 "already deleted" for nicer UX
        Effect.catchTag("NotFoundError", () =>
          Effect.fail(
            new ValidationError({
              entity: "user",
              field: "userId",
              message: "User already deleted or does not exist",
            })
          )
        ),
        // Structured audit log on success — `annotateLogs` puts fields in JSON, not the message
        Effect.tap(() =>
          Effect.logInfo("user.deleted").pipe(
            Effect.annotateLogs({ actor: ctx.auth.user.id, target: input.userId })
          )
        ),
        // Log infra failures separately from validation
        Effect.tapErrorTag("DeletionError", (e) =>
          Effect.logError("user.deletion_failed").pipe(
            Effect.annotateLogs({ cause: String(e.cause), target: input.userId })
          )
        )
      )
    )
  ),
```

### Rules

- **Default = fall-through.** Don't wrap simple CRUD with patterns it doesn't need.
- **Re-map only when the default HTTP code or message is wrong.** `NotFoundError` → 404 with `"user not found: <id>"` is fine for most reads. Re-map when the procedure has UX reasons to differ (e.g. delete should be idempotent → 400 "already gone" instead of 404).
- **Retry only transient.** Never retry a `ValidationError`. Use `Schedule.recurWhile`/`Schedule.intersect` to gate retries by tag.
- **Logging at procedure level, not in repos.** Repos stay deterministic + testable; procedures own audit/observability.
- **Bulk fail-tolerance via `Effect.partition`** if the repo exposes per-item ops. Don't loop manually with `try`/`catch`.
- **Pipe order matters**: `retry` innermost (closest to the failing call), `catchTag` re-mapping next, `tap` for logging outermost. Logs see the post-mapping outcome.

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

## HTTP boundary routes (non-tRPC)

For raw HTTP handlers (file upload, webhooks, OAuth callbacks) the response shape is `Response`, not a tRPC envelope. **Don't** route the program through `runProcedure` and then duck-type `TRPCError.code` to derive a status — that goes Effect → TRPCError → guess-the-status, losing type info both ways.

Match tagged errors directly to a `Response`. **No `try` / `catch`** — `runPromiseExit` never rejects, so failures (typed) and defects (unrecoverable) both flow through `Exit.match`:

```typescript
// app/routes/api/upload-file.ts (target shape)
import { Effect, Exit } from "effect";
import { BucketRepository } from "@/repositories/bucket";
import { ValidationError } from "@/models/errors/repository";
import type { Route } from "./+types/upload-file";

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const file = formData.get("file");

  const program = Effect.gen(function* () {
    if (!(file instanceof File)) {
      return yield* Effect.fail(
        new ValidationError({ entity: "file", field: "file", message: "No file provided" })
      );
    }
    const repo = yield* BucketRepository;
    const key = yield* repo.upload(file);
    return Response.json({ success: true, key });
  }).pipe(
    Effect.tapErrorCause((cause) => Effect.logError("Upload failed", cause)),
    Effect.catchTags({
      ValidationError: (e) => Effect.succeed(new Response(e.message, { status: 400 })),
      BucketValidationError: (e) => Effect.succeed(new Response(e.message, { status: 400 })),
      BucketNotFoundError: (e) => Effect.succeed(new Response(`Not found: ${e.key}`, { status: 404 })),
    })
  );

  const exit = await context.runtime.runPromiseExit(program);
  return Exit.match(exit, {
    onSuccess: (response) => response,
    onFailure: () => new Response("Internal Server Error", { status: 500 }),
  });
}
```

### Rules

- **Build `Response` inside the Effect** with `Effect.catchTags` / `Effect.matchTags` — don't throw, don't return `TRPCError`.
- **`runPromiseExit` + `Exit.match`** — never `runPromise` + `try`/`catch`. `runPromiseExit` returns an `Exit<A, E>` that captures both typed failures and defects; the matcher is total. No `throw` ever crosses the boundary.
- **`runProcedure` is for tRPC procedures only** — non-tRPC handlers use the runtime directly.
- **`Effect.tapErrorCause` for logging** before the catches — preserves the full cause chain in logs while the matcher returns a sanitized `Response` to the client.
- **`onFailure` returns a generic 500** — never leak `Cause.pretty` to the client body. Detail lives in the log.
- **Recoverable mapping in `Effect.catchTags`**, unrecoverable handling in `Exit.match.onFailure`. Don't merge them into a trailing `Effect.catchAll` — defects should go to `onFailure`, not be re-caught as data.
- If you find yourself writing the same matcher across handlers, add a `runHttp(runtime, program, mapping)` helper to `app/lib/effect-trpc.ts` and link from [`library.md`](library.md).

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
- **Optional chaining on `ctx.auth.user` after `protectedProcedure` / `adminProcedure`** — middleware guarantees non-null; `ctx.auth.user?.id` defeats the type contract. Read directly: `ctx.auth.user.id`.
- **Duck-typing `TRPCError.code` after `runProcedure` to derive HTTP status** in a non-tRPC handler — use the HTTP boundary pattern above (`runPromiseExit` + `Exit.match` + `Effect.catchTags` building a `Response` inside the Effect).
- **`try` / `catch` around `runPromise` at an HTTP boundary** — use `runPromiseExit` + `Exit.match` instead. The whole point of going through Effect is to keep failure typed and total; wrapping in `try`/`catch` reverts to JS exception flow.
- **`Effect.promise(() => fallibleFn())`** at any boundary — `Effect.promise` swallows throws as defects (unrecoverable). For Better Auth, fetch, third-party SDKs, use `Effect.tryPromise({ try, catch })` mapped to a tagged error (`ExternalServiceError`, `ConfigurationError`, …). See [`services.md`](services.md).
