# Services Layer

Effect Tags + Layers wrapping external clients (DB, R2, Better Auth, Workflows, per-request session, logger). **Source-of-truth files**: `app/services/**`, `app/auth/server.ts`.

> Programming model basics: see [`../codebase/effect-ts.md`](../codebase/effect-ts.md).

## Pattern: services as Effect Tags

External clients are exposed as Effect Service Tags. Repositories `yield*` the Tag — they never instantiate clients.

```typescript
// app/services/database.ts (real shape)
import { Context, Effect, Layer } from "effect";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import * as schema from "@/db/schema";
import { CloudflareEnv } from "./cloudflare";
import { ConfigurationError } from "@/models/errors/repository";

export type DrizzleD1 = ReturnType<typeof drizzleD1<typeof schema>>;
export interface DatabaseShape { readonly db: DrizzleD1 }

export class Database extends Context.Tag("app/Database")<Database, DatabaseShape>() {}

export const DatabaseLive = Layer.effect(
  Database,
  Effect.gen(function* () {
    const env = yield* CloudflareEnv;
    if (!env.DATABASE) {
      return yield* Effect.fail(new ConfigurationError({ service: "Database", field: "DATABASE" }));
    }
    return { db: drizzleD1(env.DATABASE, { schema, logger: false }) };
  })
);
```

The runtime composes services into a single Layer in `app/runtime.ts` via `makeAppRuntime(env, auth)`.

## Existing services

| Service | File | Tag id | Shape |
|---------|------|--------|-------|
| `Database` | `app/services/database.ts` | `app/Database` | `{ db: DrizzleD1 }` (drizzle over D1) |
| `Bucket` | `app/services/bucket.ts` | `app/Bucket` | `{ bucket: R2Bucket }` (raw R2 binding) |
| `AuthApi` | `app/services/auth.ts` | `app/AuthApi` | `{ auth: Auth, api: Auth["api"] }` |
| `Workflows` | `app/services/workflows.ts` | `app/Workflows` | `{ exampleWorkflow, triggerExample }` |
| `Session` | `app/services/session.ts` | `app/Session` | `{ session, user }` — built ad-hoc via `SessionLive(headers)`, **not** in the global runtime |
| `CloudflareEnv` | `app/services/cloudflare.ts` | `app/CloudflareEnv` | The raw `Env` |
| `Logger` | `app/services/logger.ts` | — (no Tag) | `LoggerLive` + `MinLogLevelLive` Layers — replace Effect's default Logger |

Repos / procedures composition lives in `app/runtime.ts` (`AppServices` union: `Database | Bucket | AuthApi | Workflows | UserRepository | AnalyticsRepository | BucketRepository`).

> **Not present in this repo:** Stripe, PostHog, Resend, external AI SDKs. If a feature needs one, follow "Adding a new service" below and document under [`../high-level-architecture/integrations.md`](../high-level-architecture/integrations.md).

## Adding a new service

1. Create `app/services/{name}.ts` with `Context.Tag` + `Layer.effect` that yields `CloudflareEnv` and constructs the client.
2. Export the class plus a `{Name}Live` Layer.
3. Add the service to the `AppServices` union and `baseLayer` / `reposLayer` composition in `app/runtime.ts`.
4. Add a test layer `app/services/{name}.test-layer.ts` (mirror `database.test-layer.ts`) for use in repo unit tests.
5. Repos consume via `const { foo } = yield* MyService;`.

**Never** instantiate the client inside a repository — yield the Tag.

## Better Auth (server config)

Configured in `app/auth/server.ts`. The `AuthApi` service exposes the running instance.

```typescript
// app/auth/server.ts (real shape)
export const drizzleConfig = {
  emailAndPassword: { enabled: true },
  plugins: [admin()],
} satisfies BetterAuthOptions;

export function createAuth(database: D1Database, secret: string, baseURL?: string) {
  return betterAuth({
    database: drizzleAdapter(getDb(database), { provider: "sqlite", schema }),
    secret,
    baseURL,
    ...drizzleConfig,
  });
}
```

- Created **per request** in `workers/app.ts` (not cached globally)
- Drizzle adapter against D1 → sessions persist in the `session` table
- Plugins enabled: `admin`, email/password
- Required env: `BETTER_AUTH_SECRET`

```typescript
// inside an Effect program (recommended pattern)
const { api } = yield* AuthApi;
const session = yield* Effect.tryPromise({
  try: () => api.getSession({ headers: request.headers }),
  catch: (cause) => new ExternalServiceError({ service: "BetterAuth", cause }),
});
```

> ⚠ Real `app/trpc/index.ts` `createTRPCContext` currently uses `Effect.promise(() => api.getSession({ headers }))` — that variant treats throws as **defects** (unrecoverable) instead of typed failures. New code should use the `Effect.tryPromise` form above so Better Auth errors surface as `ExternalServiceError` and can be caught.

Auth gating at the procedure level is handled by `protectedProcedure` / `adminProcedure` (see [`routes.md`](routes.md)) — they throw `TRPCError({ code: "UNAUTHORIZED" | "FORBIDDEN" })` directly because that's control flow, not a domain error.

**Anti-patterns:**
- `BETTER_AUTH_SECRET` exposed to client
- Caching `auth` instance across requests at module top-level
- Trusting client-side auth state for authz decisions

## Workflows (service side)

`Workflows` Tag wraps the workflow bindings so repos / procedures can trigger them via Effect. Real shape:

```typescript
// app/services/workflows.ts (real shape)
export interface WorkflowsShape {
  readonly exampleWorkflow: Workflow;
  readonly triggerExample: (params: CreateWorkflowInput) =>
    Effect.Effect<WorkflowInstance, WorkflowTriggerError>;
}

export const WorkflowsLive = Layer.effect(
  Workflows,
  Effect.map(CloudflareEnv, (env) => ({
    exampleWorkflow: env.EXAMPLE_WORKFLOW,
    triggerExample: (params) =>
      Effect.tryPromise({
        try: () => env.EXAMPLE_WORKFLOW.create({ params }),
        catch: (cause) => new WorkflowTriggerError({ name: "EXAMPLE_WORKFLOW", cause }),
      }),
  }))
);
```

Calling pattern:

```typescript
const wf = yield* Workflows;
return yield* wf.triggerExample(input);
```

`WorkflowTriggerError` is mapped to `INTERNAL_SERVER_ERROR` in `tagToTRPC`. Binding/declaration side: see [`cloudflare.md`](cloudflare.md).

## Bucket (R2)

`Bucket` exposes the raw `R2Bucket` binding. Repository methods wrap calls in `Effect.tryPromise` with bucket-specific tagged errors. Real shape (`app/services/bucket.ts`):

```typescript
export interface BucketShape { readonly bucket: R2Bucket }

export const BucketLive = Layer.effect(
  Bucket,
  Effect.gen(function* () {
    const env = yield* CloudflareEnv;
    if (!env.BUCKET) return yield* Effect.fail(new BucketBindingError({}));
    return { bucket: env.BUCKET };
  })
);
```

`BucketRepository` (`app/repositories/bucket.ts`) exposes:

| Method | Returns | Failure |
|--------|---------|---------|
| `upload(file, options?)` | `Effect<string, BucketUploadError>` (returns the key) | `BucketUploadError` |
| `get(key)` | `Effect<R2ObjectBody \| null, BucketGetError>` | `BucketGetError` |
| `remove(key)` | `Effect<void, BucketDeleteError>` | `BucketDeleteError` |
| `list(input?)` | `Effect<R2Objects, BucketListError>` | `BucketListError` |

`get` returns `null` for missing keys — wrap with `requireFound` or check explicitly if you want `BucketNotFoundError` semantics. The error type exists in `tagToTRPC` (mapped to `NOT_FOUND`) but no built-in repo method raises it today.

The default key generator: `uploads/${Date.now()}-${crypto.randomUUID()}`.

## Logger

`LoggerLive` replaces Effect's default `Logger` with a custom one that emits via `emitLog` from `app/lib/log-format.ts` (structured JSON logs in production, pretty-printed in dev). `MinLogLevelLive` sets the minimum level: `Trace` in dev, `Info` in prod.

Both are merged into the runtime base layer (no Tag — `Logger.replace(Logger.defaultLogger, customLogger)` mutates the runtime's logger). Inside Effect, log via `Effect.logInfo / logError / logDebug / logTrace`. For procedure-scoped loggers with structured fields, use `loggers.trpc.child({ path })` from `app/lib/logger.ts` (used by `timingMiddleware` in `app/trpc/index.ts`).

## Session

`SessionLive(headers)` is **not** part of the global `AppServices` runtime — it's a per-request Layer that yields `AuthApi` and resolves the session shape. Provide it locally where needed:

```typescript
const program = Effect.gen(function* () {
  const { user } = yield* Session;
  // ...
}).pipe(Effect.provide(SessionLive(request.headers)));
```

In tRPC procedures, prefer `ctx.auth` (already resolved by `createTRPCContext`).

## Context-based clients (general pattern)

External clients are created **once per request** at the worker entry. Repos receive them via Effect service Tag. Reasoning:

1. Single initialization per request
2. Mockable via test-layer
3. Env access localized
4. Predictable cleanup (`runtime.dispose()` in `ctx.waitUntil`)

Worker entry:

```typescript
// workers/app.ts (real shape)
export default {
  async fetch(request, env, ctx) {
    const auth = createAuth(env.DATABASE, env.BETTER_AUTH_SECRET, new URL(request.url).origin);
    const runtime = makeAppRuntime(env, auth);

    try {
      const trpcContext = await createTRPCContext({ headers: request.headers, runtime });
      const trpcCaller = createCaller(trpcContext);

      return await requestHandler(request, {
        cloudflare: { env, ctx },
        trpc: trpcCaller,
        auth,
        runtime,
      });
    } finally {
      ctx.waitUntil(runtime.dispose());
    }
  },
} satisfies ExportedHandler<Env>;
```

## Anti-patterns

- Repo importing a client SDK directly — yield the Service Tag
- Caching clients across requests at module top-level
- Hardcoding API keys in code (use `wrangler secret put`)
- Reading `process.env` anywhere — use `CloudflareEnv` Tag or `context.cloudflare.env`
- Forgetting `runtime.dispose()` in the worker's `finally` — leaks runtime state
