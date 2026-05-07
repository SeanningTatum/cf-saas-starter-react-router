# Testing

**Required for every helper and every repository.**

## Tooling

- Vitest — unit-test runner
- `@effect/vitest` — provides `it.effect(...)` for Effect-yielding tests
- Playwright — e2e tests in `e2e/*.spec.ts`

## Co-location

Tests live in a sibling `__tests__/` directory: `app/repositories/user.ts` → `app/repositories/__tests__/user.test.ts`. Imports use `"../foo"` to reach source.

## Stub layer for repositories

Swap `Database` with `makeTestDatabase(stub)` from `app/services/database.test-layer.ts`. The `chainable(value)` helper builds a Proxy that mimics drizzle's chainable API.

## Repository test pattern

```typescript
import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer, Exit, Cause } from "effect";
import { UserRepository } from "../user";
import { chainable, makeTestDatabase } from "@/services/database.test-layer";

const provideStub = (stub: unknown) =>
  UserRepository.Default.pipe(Layer.provide(makeTestDatabase(stub)));

it.effect("getUser fails with NotFoundError when missing", () => {
  const stub = { select: () => chainable([]) };
  return Effect.gen(function* () {
    const repo = yield* UserRepository;
    const exit = yield* Effect.exit(repo.getUser({ userId: "missing" }));
    expect(Exit.isFailure(exit)).toBe(true);
  }).pipe(Effect.provide(provideStub(stub)));
});
```

## What to test without a real DB

- Tagged-error paths (NotFoundError, ValidationError, etc.)
- Validation predicates
- Condition builders
- Default schema values
- Pure helper functions

## Commands

```bash
bun run test         # one-shot
bun run test:watch   # watch mode
bun run test:e2e     # Playwright
```
