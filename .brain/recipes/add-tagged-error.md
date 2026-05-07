# Recipe: Add a tagged error

## Steps

### 1. Define error → `app/models/errors/<domain>.ts`

```ts
import { Data } from "effect";

export class RateLimitError extends Data.TaggedError("RateLimitError")<{
  readonly endpoint: string;
  readonly retryAfter: number;
}> {}
```

**Add to the domain union AND `AppError`** ([`app/models/errors/index.ts`](../../app/models/errors/index.ts)). The union feeds `appErrorToTRPC` exhaustiveness check — if you skip this, TypeScript will not flag a missing `tagToTRPC` case.

```ts
// app/models/errors/<domain>.ts
export type ApiError = ... | RateLimitError;

// app/models/errors/index.ts (already re-exports domain unions into AppError)
```

### 2. Map to tRPC → [`app/lib/effect-trpc.ts`](../../app/lib/effect-trpc.ts)

Add a `case` inside `appErrorToTRPC()`:

```ts
case "RateLimitError":
  return new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: `Rate limit on ${e.endpoint}. Retry in ${e.retryAfter}s.`,
  });
```

> The `default: return assertNever(e)` branch makes a missing case a **compile-time error**, not a silent 500 (since 2026-05-07 hardening pass). Run `bun run typecheck` to confirm exhaustiveness.

### 3. Test mapping → [`app/lib/__tests__/effect-trpc.test.ts`](../../app/lib/__tests__/effect-trpc.test.ts)

```ts
it.effect("maps RateLimitError to TOO_MANY_REQUESTS", () =>
  Effect.gen(function* () {
    const program = Effect.fail(
      new RateLimitError({ endpoint: "/api/foo", retryAfter: 30 })
    );
    const exit = yield* Effect.exit(tagToTRPC(program));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const err = Cause.failureOption(exit.cause);
      expect(err._tag === "Some" && err.value.code).toBe("TOO_MANY_REQUESTS");
    }
  })
);
```

### 4. Update brain

- [`.brain/rules/errors.md`](../rules/errors.md) — add row to error → tRPC mapping table
- [`.brain/CHANGELOG.md`](../CHANGELOG.md) — entry

## Definition of done

- [ ] Error class in `app/models/errors/`
- [ ] `tagToTRPC` case added
- [ ] Mapping unit test green
- [ ] `errors.md` table updated

## Anti-patterns

- ❌ `throw new Error("rate limit")` — untagged, unmappable
- ❌ Adding error class without registering in `AppError` union — defeats compile-time exhaustiveness, falls through to silent 500
- ❌ Generic message in `tagToTRPC` — include the domain context (entity, identifier)
- ❌ Putting domain-specific fields outside the `<{ ... }>` shape — they won't survive serialization
