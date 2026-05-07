# Data Models

## Schema location

**Source of truth:** [`app/db/schema.ts`](../../app/db/schema.ts). Always read it directly for current column lists.

## Tables

| Table | Purpose | Key relations |
|-------|---------|---------------|
| `user` | Core user with role + ban fields | Referenced by `session.userId`, `account.userId` |
| `session` | Active sessions (Better Auth) | `userId → user.id` (cascade), `impersonatedBy` (admin user id, no FK) |
| `account` | Credential / OAuth accounts | `userId → user.id` (cascade) |
| `verification` | Email verification tokens | Linked logically by `identifier` (email) |

All four tables are owned by Better Auth's drizzle adapter. There are no app-specific business tables yet — features that need their own data add new tables here.

## Entity relationships

```
user ◄─────┬───── session   (userId, impersonatedBy)
           │
           ├───── account   (userId)
           │
           └─ ─ ─ verification (by identifier=email, no FK)
```

## SQLite / Drizzle conventions

- **Booleans**: `integer("col", { mode: "boolean" })` (stored as 0/1)
- **Timestamps**: `integer("col", { mode: "timestamp_ms" })` — Date ↔ ms-since-epoch. Default via `sql\`(cast(unixepoch('subsecond') * 1000 as integer))\`` for `createdAt` / `updatedAt`. `$onUpdate(() => new Date())` for `updatedAt`.
- **Enums**: `text("col", { enum: [...] })` — e.g. `user.role: "user" | "admin"`
- **JSON**: `text("col", { mode: "json" }).$type<T>()`
- **Foreign keys**: `references(() => parent.id, { onDelete: "cascade" })`. Always specify `onDelete`.
- **SQL identifiers**: `snake_case`. **TypeScript variables**: `camelCase`.

## Inferred types

```typescript
export type User = typeof user.$inferSelect;
export type UpdateUserInput = typeof user.$inferInsert;
```

Repository input types use Effect Schema in `app/lib/schemas/{domain}.ts` — those are the **canonical** input shapes for procedures and repos. Inferred Drizzle types are for raw row shape only.

## Migrations

- **Location**: `drizzle/`
- **Generate**: `bun run db:generate`
- **Apply locally**: `bun run db:migrate:local` (auto-runs on `bun run dev`)
- **Apply remote**: `bun run db:migrate:remote`
- **Studio**: `bun run db:studio`

See [`../rules/repository.md`](../rules/repository.md) for the full Drizzle pattern.
