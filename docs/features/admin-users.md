# Admin users

The admin area lists, searches and acts on users: `app/routes/admin/users.tsx` and its table (`app/routes/admin/components/user-data-table.tsx`), the `admin` tRPC router (`app/trpc/routes/admin.ts`) and `UserRepository` (`app/repositories/user.ts`). Who may change whom is in [docs/auth.md](../auth.md#admin-actions-one-rule-set); the input limits and the bug they closed are in [trpc-input-bounds.md](trpc-input-bounds.md#why).

## Why

- **Bulk actions take at most 50 ids, not 100.** A bulk `UPDATE` binds its `SET` columns as well as the ids, so `MAX_BULK_USER_IDS` is half of `D1_MAX_BOUND_VARIABLES` (`app/lib/constants/db.ts`). Tests: `app/lib/constants/__tests__/db.test.ts`, and "works on MAX_BULK_USER_IDS users in one call" in `app/trpc/__tests__/input-bounds.test.ts`.
- **Search uses `instr`, not `LIKE`.** Besides the wildcards, D1 refuses any `LIKE` pattern over 50 bytes, and a search term may be 100 characters. `containsLiterally` in the repository says what it does. Tests: the `admin.getUsers search` cases in `app/trpc/__tests__/input-bounds.test.ts`.
- **Bulk actions skip the caller and every admin.** `runBulkUserAction` filters the ids through `filterProtectedUsers` before the action runs and reports the rest as `skippedCount`. Test: `app/trpc/__tests__/bulk-skips-protected.test.ts`.
