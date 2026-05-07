# Recipe: Add a tRPC endpoint

> Paste-able skeleton + checklist. Stops mid-flight if any step skipped.

## Inputs

- Domain (e.g. `user`, `admin`, `analytics`)
- Operation (`query` or `mutation`)
- Auth level (`public` / `protected` / `admin`)
- Input shape (Effect Schema)
- Output shape (return type)
- New tagged errors? (yes/no)

## Steps

### 1. Define input schema → `app/lib/schemas/<domain>.ts`

```ts
import { Schema } from "effect";

export const MyInput = Schema.Struct({
  userId: Schema.String,
  page: Schema.Number,
});
export type MyInput = Schema.Schema.Type<typeof MyInput>;
```

Add unit test: `app/lib/schemas/__tests__/<domain>.test.ts` — validate happy path + each rejection case.

### 2. Add repository method (if data access needed) → `app/repositories/<entity>.ts`

```ts
myMethod = (input: MyInput) =>
  Effect.gen(this, function* () {
    const db = yield* Database;
    return yield* tryQuery({
      entity: "user",
      effect: db.select().from(user).where(eq(user.id, input.userId)),
    });
  });
```

Update repo test stub: add method to `database.test-layer.ts` if new query shape, otherwise extend existing test file `app/repositories/__tests__/<entity>.test.ts`.

### 3. Add procedure → `app/trpc/routes/<domain>.ts`

```ts
myProcedure: protectedProcedure   // or publicProcedure / adminProcedure
  .input(Schema.standardSchemaV1(MyInput))
  .query(({ ctx, input }) =>      // or .mutation
    runProcedure(
      ctx.runtime,
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        return yield* repo.myMethod(input);
      })
    )
  ),
```

Use `adminProcedure` for admin-only — already enforces `role === "admin"` server-side ([app/trpc/index.ts:94](../../app/trpc/index.ts#L94)).

### 4. Register router (if new domain) → `app/trpc/router.ts`

```ts
export const appRouter = createTRPCRouter({
  // existing
  myDomain: myDomainRouter,
});
```

### 5. Map new tagged errors (if any) → `app/lib/effect-trpc.ts`

If procedure can fail with a NEW tagged error, add a `case` to `toTRPC()`. Otherwise reuse existing mappings (NotFoundError, ValidationError, etc.). Test mapping in `app/lib/__tests__/effect-trpc.test.ts`.

### 6. Update brain

- [`.brain/codebase/api.md`](../codebase/api.md) — add row to tRPC route table
- [`.brain/rules/routes.md`](../rules/routes.md) — only if introducing new pattern
- [`.brain/CHANGELOG.md`](../CHANGELOG.md) — one-line entry

### 7. Verify

```bash
bun run typecheck
bun run test
```

## Definition of done

- [ ] Schema in `app/lib/schemas/`
- [ ] Schema unit test passes
- [ ] Procedure uses `runProcedure` + Effect.gen (no `.then`, no bare `throw`)
- [ ] Auth level correct (admin = `adminProcedure`)
- [ ] Errors flow through `tagToTRPC` (no manual `TRPCError` throws inside gen)
- [ ] Repo test passes (if added)
- [ ] `api.md` row added
- [ ] typecheck + test green

## Anti-patterns

- ❌ `throw new TRPCError(...)` inside `Effect.gen` — use `Effect.fail(new TaggedError(...))`
- ❌ `.then(res => res.foo)` on `runProcedure` — extract inside the generator
- ❌ Skipping `adminProcedure` and checking `ctx.auth.user.role` manually — use the procedure
- ❌ Schema validation done with `if`-chains instead of Effect Schema
