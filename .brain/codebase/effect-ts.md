# Effect TS — Programming Model

**This codebase is built on [Effect TS](https://effect.website).** All new code MUST use Effect.

## Non-negotiables

1. **Effect TS is the default programming model.** Repositories, helpers, tRPC handlers return `Effect<A, E, R>`. No `throw` in app code. No `try/catch` outside `Effect.tryPromise`.
2. **Effect Schema for all validation.** No Zod. tRPC inputs use `Schema.standardSchemaV1(YourSchema)`. React Hook Form uses `effectResolver(YourSchema)` from `@/lib/effect-form`.
3. **Errors are `Data.TaggedError`** in `app/models/errors/`. `tagToTRPC` in `app/lib/effect-trpc.ts` is single point translating errors → HTTP codes — every new tagged error must be added there.
4. **Every helper and every repository ships with a unit test.** See `testing.md`.
5. **Cloudflare Workers, not Node.** Bindings come from `CloudflareEnv` Effect Tag or `context.cloudflare.env`. Never `process.env`.

If you reach for `try/catch` outside `Effect.tryPromise`, or `throw` outside test code — stop. Pattern wants an `Effect`.

## Repository pattern

```typescript
// app/repositories/widget.ts
import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { widget } from "@/db/schema";
import { Database } from "@/services/database";
import { tryQuery, requireFound } from "@/lib/effect-utils";
import type { GetWidgetInput } from "@/lib/schemas/widget";

export class WidgetRepository extends Effect.Service<WidgetRepository>()(
  "app/WidgetRepository",
  {
    effect: Effect.gen(function* () {
      const { db } = yield* Database;

      const getWidget = (input: GetWidgetInput) =>
        Effect.gen(function* () {
          const rows = yield* tryQuery("widget", () =>
            db.select().from(widget).where(eq(widget.id, input.id)).limit(1)
          );
          return yield* requireFound("widget", input.id, rows[0]);
        });

      return { getWidget } as const;
    }),
  }
) {}
```

Rules:
- Each repo extends `Effect.Service` and yields its dependencies (`Database`, `Bucket`, etc.)
- Methods return `Effect<A, TaggedError, never>` (never raw promises)
- Use `tryQuery` / `tryUpdate` / `tryCreate` / `tryDelete` from `@/lib/effect-utils` for drizzle calls
- Use `requireFound` for "row or NotFoundError"
- **Never** import tRPC, never read session/context, never `throw`
- Pure helpers (predicates, query builders) live as exported top-level functions for direct test access

## tRPC procedure

```typescript
// app/trpc/routes/widget.ts
import { Effect, Schema } from "effect";
import { adminProcedure, createTRPCRouter } from "..";
import { runProcedure } from "@/lib/effect-trpc";
import { WidgetRepository } from "@/repositories/widget";
import { GetWidgetInput } from "@/lib/schemas/widget";

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
});
```

`runProcedure` runs the Effect against per-request `ManagedRuntime` and converts every tagged error into a typed `TRPCError`.

## Form

```typescript
const form = useForm<MyInput>({
  resolver: effectResolver(MySchema),
});
```

## Schema (Validation)

Schemas live in `app/lib/schemas/{domain}.ts`:

```typescript
import { Schema } from "effect";

export const GetUsersInput = Schema.Struct({
  page: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
  limit: Schema.Number.pipe(Schema.int(), Schema.between(1, 100)),
  search: Schema.optional(Schema.String),
});
export type GetUsersInput = typeof GetUsersInput.Type;
```

Bridge into tRPC with `Schema.standardSchemaV1(MySchema)`. Bridge into React Hook Form with `effectResolver(MySchema)`.

## Tagged Error → tRPC mapping

Single switch in [`app/lib/effect-trpc.ts`](../../app/lib/effect-trpc.ts) (`toTRPC`). Every entry verified by [`app/lib/__tests__/effect-trpc.test.ts`](../../app/lib/__tests__/effect-trpc.test.ts).

| Tagged error | tRPC code |
|--------------|-----------|
| `NotFoundError`, `BucketNotFoundError` | `NOT_FOUND` |
| `ValidationError`, `BucketValidationError` | `BAD_REQUEST` |
| `CreationError`, `UpdateError`, `DeletionError`, `QueryError`, `ConfigurationError`, `Bucket{Binding,Upload,Get,Delete,List}Error`, `WorkflowTriggerError` | `INTERNAL_SERVER_ERROR` |
| `ExternalServiceError` | `BAD_GATEWAY` |

To add a new tagged error: define in `app/models/errors/`, add `_tag` switch case in `app/lib/effect-trpc.ts`, add test in `app/lib/__tests__/effect-trpc.test.ts`.

```typescript
import { Data } from "effect";

export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly entity: string;
  readonly identifier: string;
}> {}
```

Use with `Effect.fail(new NotFoundError({ entity, identifier }))`. Discriminate via `_tag` or `instanceof`.

## Context-Based Clients

External-service clients are wired through Effect Layers in `app/services/`. Inputs come from `CloudflareEnv` (per-request `Env`). **Never** instantiate clients inside repositories — yield the service Tag.

Available services today (see [`../rules/services.md`](../rules/services.md) for shapes):

| Tag | Wraps |
|-----|-------|
| `Database` | D1 → Drizzle |
| `Bucket` | R2 |
| `AuthApi` | Better Auth |
| `Workflows` | CF Workflow bindings |
| `Session` | Per-request session (provided ad-hoc, not in global runtime) |
| `CloudflareEnv` | Per-request `Env` |
| `LoggerLive` / `MinLogLevelLive` | Effect Logger replacement |

Composition lives in [`app/runtime.ts`](../../app/runtime.ts):

```typescript
const baseLayer = Layer.mergeAll(DatabaseLive, BucketLive, authLayer, WorkflowsLive);
const reposLayer = Layer.mergeAll(
  UserRepository.Default,
  AnalyticsRepository.Default,
  BucketRepository.Default
);
const layer = reposLayer
  .pipe(Layer.provideMerge(baseLayer))
  .pipe(Layer.provide(CloudflareEnvLive(env)))
  .pipe(Layer.provideMerge(Layer.merge(LoggerLive, MinLogLevelLive)));
return ManagedRuntime.make(layer);
```

The runtime is built per request in [`workers/app.ts`](../../workers/app.ts) and disposed via `ctx.waitUntil(runtime.dispose())`.

## What Not To Do

- Don't bring back Zod. Repo only has `effect`, `effect/Schema`, `@effect/vitest`.
- Don't import `Database`, `Bucket`, etc. directly into a repository — `yield*` the service tag.
- Don't access `ctx` or session inside a repository — accept everything as input.
- Don't put validation in the repository layer — Schema lives at procedure boundary.
- Don't write a helper without a `*.test.ts` in a sibling `__tests__/` directory.

## Reference Docs

- Effect: https://effect.website
- Effect Schema: https://effect.website/docs/schema/introduction/
- @effect/vitest: https://effect.website/docs/testing/testclock/
