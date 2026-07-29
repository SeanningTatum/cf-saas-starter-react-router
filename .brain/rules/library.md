# Library Layer

Shared helpers, schemas, constants, testing utilities. **Source-of-truth files**: `app/lib/**`, `app/lib/schemas/**`, `e2e/**`.

> Programming model basics: see [`../codebase/effect-ts.md`](../codebase/effect-ts.md).

## Where things live

| Path | Contents |
|------|----------|
| `app/lib/effect-utils.ts` | `tryQuery`, `tryUpdate`, `tryCreate`, `tryDelete`, `requireFound`, `requireFoundOrFail` |
| `app/lib/effect-trpc.ts` | `runProcedure`, `tagToTRPC`, internal `toTRPC` switch |
| `app/lib/effect-form.ts` | `effectResolver` — re-export of `effectTsResolver` from `@hookform/resolvers/effect-ts` |
| `app/lib/session.ts` | `requireSession`, `requireAdmin`, `redirectIfAuthenticated` — loader auth-gating helpers |
| `app/lib/insights.ts` | `buildUserInsights` + named threshold constants (admin dashboard insight copy) |
| `app/lib/constants/upload.ts` | `MAX_UPLOAD_SIZE_BYTES`, `ALLOWED_UPLOAD_CONTENT_TYPES`, `isAllowedUploadContentType` |
| `app/lib/schemas/{domain}.ts` | Effect Schema definitions (`user`, `auth`, `analytics`, `bucket`, `pagination`) |
| `app/lib/utils.ts` | Generic helpers (`cn`, etc.) |
| `app/lib/date-utils.ts` | date-fns locale wrappers |
| `app/lib/log-format.ts` | Structured log formatter (`emitLog`, `isLevelEnabled`, `shouldLog`) |
| `app/lib/logger.ts` | Named loggers (`loggers.trpc`, ...) |

> **Not present:** `app/lib/{ai,gemini,claude,stripe,email}.ts`. If a feature needs them, add the directory + a `_TEMPLATE.md`-style README, then update this rule.

## Loader auth gating (`session.ts`)

`app/lib/session.ts` centralizes the `context.auth.api.getSession({ headers })` + redirect branching that used to be duplicated inline across loaders:

```typescript
import { requireSession, requireAdmin, redirectIfAuthenticated } from "@/lib/session";

// protected loader — redirects to /login if no session
export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireSession(request, context);
  return { user: session.user };
}

// admin-gated loader — redirects to /login (no session) or /dashboard (non-admin)
export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireAdmin(request, context);
  return { user: session.user };
}

// public-only loader (home, login, sign-up) — redirects an authenticated
// visitor to /dashboard (or a custom `to`) instead of rendering the route
export async function loader({ request, context }: Route.LoaderArgs) {
  await redirectIfAuthenticated(request, context);
  return null;
}
```

All three `throw redirect(...)` (React Router's throw-to-redirect convention) rather than returning it — call them for their side effect, not their return value, except `requireSession`/`requireAdmin` which also resolve the session. Typed off `AppLoadContext` (not a bespoke context shape), so they drop into any loader unchanged. See [`routes.md`](routes.md) "Auth gating recap" for the full surface table.

## Admin insight derivation (`insights.ts`)

`buildUserInsights(stats, growthData, t)` is the pure function behind the admin dashboard's "Platform Insights" panel — no i18n/formatting side effects beyond calling the passed translator. Thresholds are named constants, not magic numbers: `VERIFICATION_RATE_EXCELLENT_THRESHOLD` (80), `VERIFICATION_RATE_MODERATE_THRESHOLD` (50), `BANNED_PERCENT_HIGH_THRESHOLD` (5), `RECENT_SIGNUPS_WINDOW_DAYS` (7).

## Upload constants (`constants/upload.ts`)

Shared between the `/api/upload-file` HTTP boundary route and the UI (`FileUpload` component `accept`/`maxSize` props) so client- and server-side validation never drift apart: `MAX_UPLOAD_SIZE_BYTES` (10MB), `ALLOWED_UPLOAD_CONTENT_TYPES` (readonly tuple of MIME types), `isAllowedUploadContentType(value): value is AllowedUploadContentType` (type-guard predicate).

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
import { tryQuery, tryUpdate, tryCreate, tryDelete, requireFound, requireFoundOrFail } from "@/lib/effect-utils";

// Drizzle calls — wraps thrown Promise into a tagged error
const rows = yield* tryQuery("widget", () => db.select().from(widget).limit(1));
yield* tryUpdate("widget", () => db.update(widget).set({...}).where(eq(widget.id, id)));

// T | undefined → Effect<T, NotFoundError>
const item = yield* requireFound("widget", id, rows[0]);

// Generic form — build your own not-found tagged error instead of NotFoundError
const object = yield* requireFoundOrFail(maybeObject, () => new BucketNotFoundError({ key }));
```

| Helper | Wraps | Failure |
|--------|-------|---------|
| `tryQuery(entity, () => ...)` | drizzle SELECT | `QueryError` |
| `tryCreate(entity, () => ...)` | INSERT | `CreationError` |
| `tryUpdate(entity, () => ...)` | UPDATE | `UpdateError` |
| `tryDelete(entity, () => ...)` | DELETE | `DeletionError` |
| `requireFound(entity, id, row)` | `T \| null \| undefined → Effect<T, NotFoundError>` | `NotFoundError` |
| `requireFoundOrFail(value, onMissing)` | `T \| null \| undefined → Effect<T, E>` | caller-supplied `E` (e.g. `BucketNotFoundError`) |

`requireFound` is now implemented in terms of `requireFoundOrFail` (`requireFoundOrFail(value, () => new NotFoundError({ entity, identifier }))`) — use `requireFoundOrFail` directly whenever the not-found case needs a domain-specific tagged error rather than the generic `NotFoundError`.

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
- `app/services/database.test-layer.ts` — `makeTestDatabase(stub)` swaps the `Database` service in repo tests; `chainable(value)` builds a Proxy mimicking drizzle's `select().from().where()` chain; `chainableSpy(value)` wraps `chainable(value)` in a `vi.fn()` so a stub method (e.g. `update: chainableSpy(undefined)`) is both a working chain stand-in **and** assertable via `toHaveBeenCalledWith(...)` / `toHaveBeenCalledTimes(...)` — use it to prove *which* drizzle method a repo call actually invoked

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
import { chainable, chainableSpy, makeTestDatabase } from "@/services/database.test-layer";
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

it.effect("updateUser calls db.update", () => {
  const update = chainableSpy(undefined);
  const stub = { select: () => chainable([{ id: "u1", role: "user" }]), update };
  return Effect.gen(function* () {
    const repo = yield* UserRepository;
    yield* repo.updateUser({ userId: "u1", data: {}, currentUserId: "admin" });
    expect(update).toHaveBeenCalledTimes(1);
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

## Playwright (e2e smoke specs — CI regression net)

Lives in `e2e/*.spec.ts`. Use `@playwright/test`. CI (`.github/workflows/ci.yml`) re-runs these on every PR.

> **Port pinning**: `playwright.config.ts` starts the dev server with `--strictPort` and reads `E2E_PORT` (default 5173). If 5173 is occupied by another project's dev server, run `E2E_PORT=5199 bun run test:e2e` — without `--strictPort`, Vite silently bumps ports and e2e runs against the wrong app (this happened; symptom: forms submit natively via GET, specs time out).

> **Scope: thin and stable, not one-per-feature.** These specs guard critical paths (auth, and any flow whose regression would be costly) against future breakage. Feature-level proof is the [`feature-verifier`](../../.claude/agents/feature-verifier.md) sub-agent + a doc in [`features/<slug>/verifications/`](../features/index.md), not a new spec each time. Add/extend a spec here only when a path is critical enough to warrant automated CI coverage.

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

Local dev + preview. Created by the seed script (`scripts/seed-preview.ts`), which inserts three fixtures sharing one password:

```bash
bun run db:seed          # local D1
bun run db:seed:preview  # preview-env D1
```

| Fixture | Email | Password | Role |
|---------|-------|----------|------|
| Admin | `admin@preview.local` | `Password123!` | `admin` |
| Regular user | `user@preview.local` | `Password123!` | `user` |
| Banned user | `banned@preview.local` | `Password123!` | `user` (banned) |

Rows use fixed `seed-*` ids and `INSERT OR IGNORE`, so re-seeding is idempotent. The local D1 database name is `cf-saas-starter-react-router-db` (see `wrangler.jsonc`).

(Better Auth requires user creation through the API, not direct insert. The D1 binding name is `DATABASE`; `database_name` is `testing-db` per `wrangler.jsonc`.)

### Feature verification with the Playwright CLI

Feature-level flows are verified by driving the **live app**, not by writing a committed spec. The [`feature-verifier`](../../.claude/agents/feature-verifier.md) sub-agent authors a throwaway Playwright script (`chromium.launch()` → `page.goto`/`getByTestId`/`click`/`fill` → `page.screenshot`), runs it headless via `bun run <script>`, walks the golden + one error path, and writes a verdict doc to [`features/<slug>/verifications/<date>.md`](../features/index.md). The temp script is deleted after; only screenshots + doc are kept. See [`frontend.md`](frontend.md) and [`recipes/99-verify-done.md`](../recipes/99-verify-done.md) §4.

## Anti-patterns

- Helpers defined inline in repos / routes / components — move to `@/lib/utils`
- Magic numbers / strings scattered through code — collect into a typed module
- Zod imports — schemas use Effect Schema
- Tests scattered inline as `foo.test.ts` next to source — use `__tests__/` subdirectory
- Playwright selectors via `getByText` for non-unique text
- Skipping tests "because the function is trivial" — every helper gets a test
