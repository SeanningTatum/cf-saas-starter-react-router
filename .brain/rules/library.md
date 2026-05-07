# Library Layer

Shared helpers, schemas, constants, testing utilities. **Source-of-truth files**: `app/lib/**`, `app/lib/schemas/**`, `e2e/**`.

> Programming model basics: see [`../codebase/effect-ts.md`](../codebase/effect-ts.md).

## Where things live

| Path | Contents |
|------|----------|
| `app/lib/effect-utils.ts` | `tryQuery`, `tryUpdate`, `tryCreate`, `tryDelete`, `requireFound` |
| `app/lib/effect-trpc.ts` | `runProcedure`, `tagToTRPC`, internal `toTRPC` switch |
| `app/lib/effect-form.ts` | `effectResolver` — re-export of `effectTsResolver` from `@hookform/resolvers/effect-ts` |
| `app/lib/schemas/{domain}.ts` | Effect Schema definitions (`user`, `auth`, `analytics`, `bucket`, `pagination`) |
| `app/lib/utils.ts` | Generic helpers (`cn`, etc.) |
| `app/lib/date-utils.ts` | date-fns locale wrappers |
| `app/lib/log-format.ts` | Structured log formatter |
| `app/lib/logger.ts` | Named loggers (`loggers.trpc`, ...) |

> **Not present:** `app/lib/{ai,gemini,claude,stripe,email}.ts`, `app/lib/constants/`. If a feature needs them, add the directory + a `_TEMPLATE.md`-style README, then update this rule.

## Schemas (Effect Schema)

All input / output validation. **No Zod.**

```typescript
// app/lib/schemas/user.ts (real shape)
import { Schema } from "effect";

export const Role = Schema.Literal("user", "admin");
export type Role = typeof Role.Type;

export const GetUsersInput = Schema.Struct({
  page: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(0),
    Schema.optionalWith({ default: () => 0 })
  ),
  limit: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(1),
    Schema.lessThanOrEqualTo(100),
    Schema.optionalWith({ default: () => 10 })
  ),
  search: Schema.optional(Schema.String),
  role: Schema.optional(Role),
});
export type GetUsersInput = typeof GetUsersInput.Type;
```

Naming: `PascalCaseInput` / `PascalCaseOutput` for the Schema **and** its inferred type. One file per entity (`user.ts`, `analytics.ts`, …). Re-export from `app/lib/schemas/index.ts`.

Bridges:
- tRPC: `Schema.standardSchemaV1(MySchema)`
- React Hook Form: `effectResolver(MySchema)` from `@/lib/effect-form`

Each schema gets a `*.test.ts` covering happy decode + at least one rejection per refinement. See `app/lib/schemas/__tests__/user.test.ts` for canonical examples.

## Effect helpers (`effect-utils.ts`)

```typescript
import { tryQuery, tryUpdate, tryCreate, tryDelete, requireFound } from "@/lib/effect-utils";

// Drizzle calls — wraps thrown Promise into a tagged error
const rows = yield* tryQuery("widget", () => db.select().from(widget).limit(1));
yield* tryUpdate("widget", () => db.update(widget).set({...}).where(eq(widget.id, id)));

// T | undefined → Effect<T, NotFoundError>
const item = yield* requireFound("widget", id, rows[0]);
```

| Helper | Wraps | Failure |
|--------|-------|---------|
| `tryQuery(entity, () => ...)` | drizzle SELECT | `QueryError` |
| `tryCreate(entity, () => ...)` | INSERT | `CreationError` |
| `tryUpdate(entity, () => ...)` | UPDATE | `UpdateError` |
| `tryDelete(entity, () => ...)` | DELETE | `DeletionError` |
| `requireFound(entity, id, row)` | `T \| null \| undefined → Effect<T, NotFoundError>` | `NotFoundError` |

## Utils (`utils.ts`)

Generic helpers. **Never** define helpers inline in repos / routes / components.

```typescript
import { cn } from "@/lib/utils";
<div className={cn("p-4", isActive && "bg-primary", className)} />
```

## Testing

**Required for every helper, every repository, every schema, every tagged error.**

### Tooling

- `vitest` — runner
- `@effect/vitest` — provides `it.effect(...)` for Effect-yielding tests
- `app/services/database.test-layer.ts` — `makeTestDatabase(stub)` swaps the `Database` service in repo tests; `chainable(value)` builds a Proxy mimicking drizzle's `select().from().where()` chain

### Co-location

Tests live in a sibling `__tests__/` directory. `app/lib/foo.ts` → `app/lib/__tests__/foo.test.ts`. Imports use `"../foo"` to reach source.

### Run

```bash
bun run test         # one-shot
bun run test:watch   # watch
bun run test:e2e     # Playwright
```

### Pure helper

```typescript
// app/repositories/__tests__/user.test.ts
import { describe, it, expect } from "vitest";
import { isProtectedUser } from "../user";

describe("isProtectedUser", () => {
  it("returns true for admin role", () => {
    expect(isProtectedUser({ role: "admin", id: "u1" }, "u2")).toBe(true);
  });
});
```

### Effect helper

```typescript
import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Exit, Cause } from "effect";
import { tryQuery } from "../effect-utils";
import { QueryError } from "@/models/errors/repository";

it.effect("wraps thrown error as QueryError", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(
      tryQuery("widget", async () => { throw new Error("boom"); })
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause);
      if (failure._tag === "Some") expect(failure.value).toBeInstanceOf(QueryError);
    }
  })
);
```

### Repository

```typescript
import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer, Exit, Cause } from "effect";
import { UserRepository } from "../user";
import { chainable, makeTestDatabase } from "@/services/database.test-layer";
import { NotFoundError } from "@/models/errors/repository";

const provideStub = (stub: unknown) =>
  UserRepository.Default.pipe(Layer.provide(makeTestDatabase(stub)));

it.effect("getUser fails with NotFoundError when missing", () => {
  const stub = { select: () => chainable([]) };
  return Effect.gen(function* () {
    const repo = yield* UserRepository;
    const exit = yield* Effect.exit(repo.getUser({ userId: "missing" }));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause);
      if (failure._tag === "Some") expect(failure.value).toBeInstanceOf(NotFoundError);
    }
  }).pipe(Effect.provide(provideStub(stub)));
});
```

### Schema

```typescript
import { describe, it, expect } from "vitest";
import { Schema } from "effect";
import { GetUserInput } from "../user";

describe("GetUserInput", () => {
  it("decodes a valid userId", () => {
    expect(Schema.decodeUnknownEither(GetUserInput)({ userId: "x" })._tag).toBe("Right");
  });
  it("rejects missing userId", () => {
    expect(Schema.decodeUnknownEither(GetUserInput)({})._tag).toBe("Left");
  });
});
```

### Coverage targets

- Every `app/lib/` public function — has a test file
- Every `Effect.Service` method — happy path + each tagged-error path it explicitly handles
- Every Schema — happy + at least one rejection per refinement
- Every new tagged error — entry in `app/lib/__tests__/effect-trpc.test.ts` asserting HTTP code

If drizzle is hard to stub (joins, transactions): extract pure logic into a top-level function, test that directly, keep the side-effecting wrapper thin. Examples: `isProtectedUser`, `buildUserConditions` in `app/repositories/user.ts`.

## Playwright (e2e)

Lives in `e2e/*.spec.ts`. Use `@playwright/test`.

### Patterns

```typescript
import { test, expect } from "@playwright/test";

test.describe("Widget feature", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.fill('[data-testid="email"]', "admin@test.local");
    await page.fill('[data-testid="password"]', "TestAdmin123!");
    await page.click('[data-testid="login-button"]');
    await page.waitForURL("/dashboard");
  });

  test("creates a widget", async ({ page }) => {
    await page.goto("/admin/widgets");
    await page.click('[data-testid="create-widget"]');
    await page.fill('[data-testid="widget-name"]', "Test");
    await page.click('[data-testid="submit"]');
    await expect(page.locator('[data-testid="widget-row"]')).toContainText("Test");
  });
});
```

### Rules

- **Selectors**: prefer `getByTestId()` or `locator('#id')`. Avoid `getByLabel()` / `getByText()` — labels and text duplicate. Semantic selectors (`getByRole`) only when no testid available.
- **Group**: `test.describe()` for related tests. `test.beforeEach()` for shared setup.
- **`data-testid`**: add to every interactive element. Convention: kebab-case. For collections: `row-${item.id}`.
- **Test categories**: smoke (critical paths), feature (workflows), regression (previously broken), edge (boundaries).

### Test admin credentials

Local dev only. Created via sign-up flow then upgraded:

```bash
bunx wrangler d1 execute testing-db --local --command "UPDATE user SET role = 'admin', email_verified = 1 WHERE email = 'admin@test.local';"
```

| Field | Value |
|-------|-------|
| Email | `admin@test.local` |
| Password | `TestAdmin123!` |
| Role | `admin` |

Cleanup if user exists:
```bash
bunx wrangler d1 execute testing-db --local --command "DELETE FROM account WHERE user_id IN (SELECT id FROM user WHERE email = 'admin@test.local'); DELETE FROM session WHERE user_id IN (SELECT id FROM user WHERE email = 'admin@test.local'); DELETE FROM user WHERE email = 'admin@test.local';"
```

(Better Auth requires user creation through the API, not direct insert. The D1 binding name is `DATABASE`; `database_name` is `testing-db` per `wrangler.jsonc`.)

### Manual verification with Playwright MCP

For frontend changes during dev, before writing the e2e: use `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_fill_form`, `browser_take_screenshot`. See [`frontend.md`](frontend.md) for the loop.

## Anti-patterns

- Helpers defined inline in repos / routes / components — move to `@/lib/utils`
- Magic numbers / strings scattered through code — collect into a typed module
- Zod imports — schemas use Effect Schema
- Tests scattered inline as `foo.test.ts` next to source — use `__tests__/` subdirectory
- Playwright selectors via `getByText` for non-unique text
- Skipping tests "because the function is trivial" — every helper gets a test
