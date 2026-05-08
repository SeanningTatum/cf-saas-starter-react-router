# Errors Layer

Tagged-error model with single mapping point at the tRPC boundary. **Source-of-truth files**: `app/models/errors/**`, `app/lib/effect-trpc.ts`, `app/lib/effect-utils.ts`.

> Programming model basics: see [`../codebase/effect-ts.md`](../codebase/effect-ts.md).

## Model

All errors are `Data.TaggedError` ADTs. The single mapping point from tagged error → HTTP status is `tagToTRPC` in `app/lib/effect-trpc.ts`. **No class hierarchies.** **No `Object.setPrototypeOf`.**

```typescript
// app/models/errors/widget.ts
import { Data } from "effect";

export class WidgetLockedError extends Data.TaggedError("WidgetLockedError")<{
  readonly widgetId: string;
  readonly reason: string;
}> {}
```

The argument shape becomes readonly fields on the instance. Discriminate via `_tag` or `instanceof`.

## Existing errors

### Repository (`app/models/errors/repository.ts`)

| Error | Fields | TRPC code |
|-------|--------|-----------|
| `NotFoundError` | `entity`, `identifier` | `NOT_FOUND` |
| `CreationError` | `entity`, `cause?` | `INTERNAL_SERVER_ERROR` |
| `UpdateError` | `entity`, `cause?` | `INTERNAL_SERVER_ERROR` |
| `DeletionError` | `entity`, `cause?` | `INTERNAL_SERVER_ERROR` |
| `QueryError` | `entity`, `cause?` | `INTERNAL_SERVER_ERROR` |
| `ValidationError` | `entity`, `message`, `field?` | `BAD_REQUEST` |
| `ConfigurationError` | `service`, `field?` | `INTERNAL_SERVER_ERROR` |
| `ExternalServiceError` | `service`, `cause?` | `BAD_GATEWAY` |

### Bucket (`app/models/errors/bucket.ts`)

| Error | Fields | TRPC code |
|-------|--------|-----------|
| `BucketBindingError` | `message?` | `INTERNAL_SERVER_ERROR` |
| `BucketUploadError` | `cause?` | `INTERNAL_SERVER_ERROR` |
| `BucketGetError` | `cause?` | `INTERNAL_SERVER_ERROR` |
| `BucketNotFoundError` | `key` | `NOT_FOUND` |
| `BucketDeleteError` | `cause?` | `INTERNAL_SERVER_ERROR` |
| `BucketListError` | `cause?` | `INTERNAL_SERVER_ERROR` |
| `BucketValidationError` | `message`, `field?` | `BAD_REQUEST` |

### Workflow (`app/models/errors/workflow.ts`)

| Error | Fields | TRPC code |
|-------|--------|-----------|
| `WorkflowTriggerError` | `name`, `cause?` | `INTERNAL_SERVER_ERROR` |

## Adding a new tagged error

1. Define the class in `app/models/errors/{domain}.ts` (or extend an existing union)
2. Re-export from `app/models/errors/index.ts`. Add to the `AppError` union if domain-broad.
3. Add a `case "MyError":` to `toTRPC` in `app/lib/effect-trpc.ts` mapping to a TRPC code
4. Add a unit test in `app/lib/__tests__/effect-trpc.test.ts` asserting the mapping

```typescript
// app/lib/__tests__/effect-trpc.test.ts
it("maps WidgetLockedError to FORBIDDEN", () => {
  expectTRPC(
    Effect.fail(new WidgetLockedError({ widgetId: "w1", reason: "billing" })),
    "FORBIDDEN"
  );
});
```

## Using errors in repositories

Wrap drizzle / R2 calls with helpers from `@/lib/effect-utils`:

```typescript
import { tryQuery, tryUpdate, tryCreate, tryDelete, requireFound } from "@/lib/effect-utils";

const rows = yield* tryQuery("widget", () => db.select().from(widget).limit(1));
const item = yield* requireFound("widget", id, rows[0]);

yield* tryUpdate("widget", () =>
  db.update(widget).set({ /* ... */ }).where(eq(widget.id, id))
);
```

Helpers:

| Helper | Wraps | Failure |
|--------|-------|---------|
| `tryQuery(entity, () => ...)` | drizzle SELECT | `QueryError` |
| `tryCreate(entity, () => ...)` | INSERT | `CreationError` |
| `tryUpdate(entity, () => ...)` | UPDATE | `UpdateError` |
| `tryDelete(entity, () => ...)` | DELETE | `DeletionError` |
| `requireFound(entity, id, row)` | `T \| undefined → Effect<T, NotFoundError>` | `NotFoundError` |

## Using errors in tRPC procedures

`tagToTRPC` handles canonical mapping automatically — for **simple CRUD procedures** (single repo call after a pre-condition check) you do nothing.

For **complex procedures** (multi-step, third-party side effects, bulk ops, transient failures, domain-specific recovery), transform errors at the procedure layer **before** `runProcedure` falls back to `tagToTRPC`. Patterns + when-to-apply table is in [`routes.md` "Procedure-level error transformation"](routes.md#procedure-level-error-transformation). Common shapes:

| Need | Operator |
|------|----------|
| Re-map one tag with richer message | `Effect.catchTag("Tag", e => Effect.fail(new BetterTag(...)))` |
| Re-map several at once | `Effect.catchTags({ A: ..., B: ... })` |
| Retry transient infra failure | `Effect.retry({ times, schedule })` |
| Structured success/audit log | `Effect.tap` |
| Log specific failure shape | `Effect.tapErrorTag` |
| Bulk fail-tolerance | `Effect.partition` |
| SLA timeout | `Effect.timeout` |

Direct `Effect.fail(new SomeTaggedError(...))` inside an `Effect.gen` is still the right tool for **procedure-specific pre-conditions** (auth-self-check, business invariants). Example:

```typescript
.mutation(({ ctx, input }) =>
  runProcedure(
    ctx.runtime,
    Effect.gen(function* () {
      if (input.id === ctx.auth.user.id) {
        return yield* Effect.fail(
          new ValidationError({
            entity: "user",
            message: "Cannot delete self",
            field: "userId",
          })
        );
      }
      const repo = yield* UserRepository;
      return yield* repo.deleteUser({
        ...input,
        currentUserId: ctx.auth.user.id,
      });
    })
  )
)
```

## Mapping table (canonical, mirrors `tagToTRPC`)

| Tagged error | TRPC code |
|--------------|-----------|
| `NotFoundError`, `BucketNotFoundError` | `NOT_FOUND` |
| `ValidationError`, `BucketValidationError` | `BAD_REQUEST` |
| `CreationError`, `UpdateError`, `DeletionError`, `QueryError`, `ConfigurationError`, `Bucket{Binding,Upload,Get,Delete,List}Error`, `WorkflowTriggerError` | `INTERNAL_SERVER_ERROR` |
| `ExternalServiceError` | `BAD_GATEWAY` |

## Anti-patterns

- `throw new Error(...)` in app code (test code OK)
- `try / catch` outside `Effect.tryPromise` or `Effect.try`
- Class hierarchies with `Object.setPrototypeOf` — old style, gone
- Constructing `TRPCError` directly inside a procedure for **domain** errors — emit a tagged error and let `tagToTRPC` map it. (Only acceptable for procedure-specific control flow like auth checks.)
- Adding a tagged error without (a) registering in `tagToTRPC`, (b) writing the mapping test
- `Effect.die` for recoverable conditions — that's for unrecoverable defects only
