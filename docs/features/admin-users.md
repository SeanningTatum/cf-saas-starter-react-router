# Admin users

The admin area lists, searches and acts on users: `app/routes/admin/users.tsx` and its table (`app/routes/admin/components/user-data-table.tsx`), the `admin` tRPC router (`app/trpc/routes/admin.ts`) and `UserRepository` (`app/repositories/user.ts`). Who may change whom is in [docs/auth.md](../auth.md#admin-actions-one-rule-set).

## Why

- **Bulk actions take at most 50 ids.** D1 binds at most 100 variables in one statement, and a bulk `UPDATE` binds its `SET` columns as well as the ids, so `MAX_BULK_USER_IDS` is half of `D1_MAX_BOUND_VARIABLES` (`app/lib/constants/db.ts`). Tests: `app/lib/constants/__tests__/db.test.ts`, and "works on MAX_BULK_USER_IDS users in one call" in `app/trpc/__tests__/input-bounds.test.ts`.
- **Search matches the term literally.** `containsLiterally` uses `instr`, not `LIKE`: with `LIKE`, `%` and `_` in the term would act as wildcards, and D1 refuses any `LIKE` pattern over 50 bytes, while a search term may be 100 characters. Tests: the `admin.getUsers search` cases in `app/trpc/__tests__/input-bounds.test.ts`.
