# Repository Layer

Data access via `Effect.Service` repositories. **Source-of-truth files**: `app/repositories/**`, `app/db/schema.ts`, `app/lib/schemas/**`, `app/lib/effect-utils.ts`.

> Programming model basics: see [`../codebase/effect-ts.md`](../codebase/effect-ts.md). Errors: see [`errors.md`](errors.md).

## Repository skeleton

```typescript
// app/repositories/widget.ts
import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { Database } from "@/services/database";
import { tryQuery, tryUpdate, requireFound } from "@/lib/effect-utils";
import { widget } from "@/db/schema";
import type { GetWidgetInput, UpdateWidgetInput } from "@/lib/schemas/widget";

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

      const updateWidget = (input: UpdateWidgetInput) =>
        Effect.gen(function* () {
          yield* getWidget({ id: input.id });
          yield* tryUpdate("widget", () =>
            db.update(widget).set(input.patch).where(eq(widget.id, input.id))
          );
          return { success: true } as const;
        });

      return { getWidget, updateWidget } as const;
    }),
  }
) {}
```

## Rules

- **Location**: `app/repositories/{entity}.ts`
- **Dependencies**: `yield*` service tags (`Database`, `Bucket`, `AuthApi`, `Workflows`). **Never** accept `db` as a parameter (legacy shape — gone).
- **Inputs**: typed Effect Schema in `app/lib/schemas/{domain}.ts`
- **Methods**: return `Effect<A, TaggedError, never>` — never `Promise<A>`, never `throw`
- **Wrappers — REQUIRED**: every drizzle / R2 / fetch call goes through `tryQuery` / `tryUpdate` / `tryCreate` / `tryDelete` / `requireFound` (or `requireFoundOrFail`) from `@/lib/effect-utils`. Hand-rolled `Effect.tryPromise({ try, catch })` blocks inside a repository are no longer acceptable — if a helper doesn't fit, extend `effect-utils.ts` rather than reaching for raw `Effect.tryPromise`.
- **`requireFound`**: convert `T | undefined` → `Effect<T, NotFoundError>`. Use `requireFoundOrFail(value, onMissing)` when the not-found case needs a domain-specific tagged error instead of the generic `NotFoundError` (e.g. `BucketRepository.get` → `BucketNotFoundError`).
- **Errors**: `Data.TaggedError` from `@/models/errors`. Never raw `Error`. See [`errors.md`](errors.md).
- **No tRPC imports**: repository must be framework-agnostic
- **No context access**: pass identity / role through input parameters (e.g. `currentUserId` field)
- **Pure helpers**: extract predicates / SQL-condition builders to top-level exported functions so tests can call them directly

## Wire into runtime

After creating repo, edit `app/runtime.ts`:

```typescript
export type AppServices =
  | Database
  | Bucket
  | AuthApiTag
  | Workflows
  | UserRepository
  | AnalyticsRepository
  | BucketRepository
  | WidgetRepository;        // add

const reposLayer = Layer.mergeAll(
  UserRepository.Default,
  AnalyticsRepository.Default,
  BucketRepository.Default,
  WidgetRepository.Default,  // add
);
```

## Drizzle schema (D1 / SQLite)

All tables in `app/db/schema.ts`. SQLite via `sqliteTable`.

```typescript
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const widget = sqliteTable("widget", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  email: text("email").notNull().unique(),

  isActive: integer("is_active", { mode: "boolean" }).default(false).notNull(),

  status: text("status", { enum: ["pending", "active", "completed"] })
    .default("pending")
    .notNull(),

  metadata: text("metadata", { mode: "json" }).$type<{ key?: string; value?: number }>(),

  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),

  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => new Date())
    .notNull(),
});

export type Widget = typeof widget.$inferSelect;
export type InsertWidget = typeof widget.$inferInsert;
```

### Conventions

- Booleans: `integer("col", { mode: "boolean" })`
- Timestamps: `integer("col", { mode: "timestamp_ms" })` with the `unixepoch('subsecond') * 1000` default — always include `createdAt` + `updatedAt`
- Enums: `text("col", { enum: [...] })`
- JSON: `text("col", { mode: "json" }).$type<T>()`
- Foreign keys: always specify `onDelete` (`cascade` | `set null` | `restrict`)
- SQL identifiers: `snake_case`
- TypeScript variables: `camelCase`

### Generate migration

```bash
bun run db:generate         # Generate Drizzle migration from schema.ts
bun run db:migrate:local    # Apply to local D1
bun run db:migrate:remote   # Apply to remote D1
```

## Schemas (Effect Schema)

Inputs / outputs typed in `app/lib/schemas/{domain}.ts`:

```typescript
import { Schema } from "effect";

export const GetWidgetInput = Schema.Struct({
  id: Schema.String,
});
export type GetWidgetInput = typeof GetWidgetInput.Type;

export const UpdateWidgetInput = Schema.Struct({
  id: Schema.String,
  patch: Schema.Struct({
    name: Schema.optional(Schema.String),
    isActive: Schema.optional(Schema.Boolean),
  }),
});
export type UpdateWidgetInput = typeof UpdateWidgetInput.Type;
```

Bridge: `Schema.standardSchemaV1(...)` → tRPC, `effectResolver(...)` → React Hook Form. **No Zod.**

## Tests (required)

Every repository ships `__tests__/widget.test.ts` in its parent directory (`app/repositories/__tests__/widget.test.ts`). Stub `Database` via `makeTestDatabase(stub)` from `app/services/database.test-layer.ts`. See [`library.md`](library.md) for test patterns.

## Seed data

Deterministic fixtures for local dev + per-PR preview D1 databases live in [`scripts/seed-preview.ts`](../../scripts/seed-preview.ts) (not a repository or Effect service — a standalone dev script, Node APIs allowed).

- **Idempotency**: every insert is `INSERT OR IGNORE`, keyed on fixed `seed-*` ids (e.g. `seed-admin`, `seed-admin-account`). Safe to rerun on every `bun run dev` and every PR synchronize — never clobbers rows a human or test has since modified.
- **IDs**: always deterministic (`seed-<name>`, `seed-<name>-account`), never random — reruns must be stable.
- **Invocation**: `bun run db:seed` (local D1, `--local`) and `bun run db:seed:preview` (preview-env D1, `--env preview --remote`); CI runs the latter on every PR push (`.github/workflows/preview.yml`, step "Seed per-PR D1").
- **`--describe`**: emits a markdown summary of the fixtures (accounts table + seeded-data description) — `preview.yml` embeds it in the PR sticky comment, so extending `FIXTURES` (or `describeMarkdown()` for new tables) automatically updates every future preview comment. Keep `describeMarkdown()` accurate when adding seeded tables.
- **RULE — seed evolves with features**: every feature that adds a table or user-visible data **MUST** extend the fixtures in `scripts/seed-preview.ts` in the same diff. Reviewers rely on preview URLs having representative data — a preview with an empty DB defeats the point of per-PR previews.
- **Never seed production** by default — the script refuses `--remote` (top-level prod D1) unless `--force-production` is also passed. That escape hatch exists for emergencies only (e.g. bootstrapping a fresh prod DB), not routine use.

## Bucket repository: `get` fails on missing key

`BucketRepository.get(key)` (`app/repositories/bucket.ts`) no longer returns `R2ObjectBody | null` for a missing object — it wraps the R2 call with `requireFoundOrFail(object, () => new BucketNotFoundError({ key }))`, so a miss now fails with `BucketNotFoundError` (mapped to `NOT_FOUND` in `tagToTRPC`) instead of silently succeeding with `null`. Callers that used to check `if (!object)` should let the tagged error propagate instead.

## Anti-patterns

- `async function getX(db, input)` — old shape, gone. Always `Effect.Service`.
- Repos that accept `db` as parameter
- Repos that import `ctx`, session, headers, request
- Repos that throw or use `try/catch` (outside `Effect.tryPromise`)
- Hand-rolled `Effect.tryPromise({ try, catch })` in a repo method where `tryQuery`/`tryUpdate`/`tryCreate`/`tryDelete`/`requireFound(OrFail)` already fit — extend `effect-utils.ts` instead of bypassing it. (`bulkUpdateUsersUnsafe`, a hand-rolled bulk-update path that skipped the shared wrappers, was deleted for this reason — use `tryUpdate` + `inArray(...)` per `bulkUpdateUserRoles`.)
- Repos that import from `@/trpc` or `@/auth`
- Inline SQL string concatenation — use Drizzle's typed builders
- Shared mutable state in repo closure — derive everything from `yield*`'d services + inputs
