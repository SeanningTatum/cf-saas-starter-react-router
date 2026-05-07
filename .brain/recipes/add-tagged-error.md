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

Add to the domain union if one exists:

```ts
export type ApiError = ... | RateLimitError;
```

### 2. Map to tRPC → [`app/lib/effect-trpc.ts`](../../app/lib/effect-trpc.ts)

Add a `case` inside `toTRPC()`:

```ts
case "RateLimitError":
  return new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message: `Rate limit on ${e.endpoint}. Retry in ${e.retryAfter}s.`,
  });
```

> If you skip this, the error falls through to `INTERNAL_SERVER_ERROR` and the client sees nothing useful.

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
- ❌ Adding error class without `tagToTRPC` entry — silent 500s
- ❌ Generic message in `tagToTRPC` — include the domain context (entity, identifier)
- ❌ Putting domain-specific fields outside the `<{ ... }>` shape — they won't survive serialization
