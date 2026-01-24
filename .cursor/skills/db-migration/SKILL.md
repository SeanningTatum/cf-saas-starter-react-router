---
name: db-migration
description: Generate Drizzle database migrations with descriptive names. Use when the user asks to create a migration, generate a migration, add database changes, or modify the schema and needs a migration generated.
---

# Database Migration Generator

Generate Drizzle ORM migrations for schema changes.

## Before Generating

1. **Verify schema changes exist** in `app/db/schema.ts`
2. If schema hasn't been updated yet, make the necessary changes first

## Generate Migration

Run with a descriptive snake_case name:

```bash
bun run db:generate --name "migration_name"
```

### Naming Convention

Use **snake_case** names that describe the change:

| Change Type | Example Name |
|-------------|--------------|
| Add table | `add_user_preferences` |
| Add column | `add_avatar_to_users` |
| Remove column | `remove_legacy_field` |
| Add index | `add_email_index` |
| Modify column | `change_status_to_enum` |

## Example Workflow

1. Update schema in `app/db/schema.ts`
2. Generate migration:
   ```bash
   bun run db:generate --name "add_user_preferences"
   ```
3. Review generated SQL in `drizzle/` folder

## Migration Output

Migrations are generated in the `drizzle/` directory as numbered SQL files (e.g., `0001_add_user_preferences.sql`).
