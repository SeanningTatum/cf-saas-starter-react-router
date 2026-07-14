# Recipe: Ship a new feature

End-to-end checklist for new product features. Touches multiple layers.

## 0. Scope

Before code: open [`.brain/features/_TEMPLATE.md`](../features/_TEMPLATE.md), copy to `.brain/features/<slug>/<slug>.md`, fill at minimum:
- Purpose
- When used
- Persistence (D1 tables, R2 keys, KV)
- Tagged errors

If you can't fill these — scope is unclear. Stop. Ask for clarity.

## 1. Persistence

If new tables needed → run [add-db-table.md](add-db-table.md) first. Repository must exist before tRPC routes. If the feature adds user-visible data, extend fixtures in [`scripts/seed-preview.ts`](../../scripts/seed-preview.ts) in the same diff — see [`.brain/rules/repository.md`](../rules/repository.md) ("Seed data").

## 2. External clients / bindings

If integrating new external service or CF binding → run [add-cf-binding.md](add-cf-binding.md).

## 3. Server logic

For each operation:
- Run [add-trpc-endpoint.md](add-trpc-endpoint.md)
- Add tagged errors via [add-tagged-error.md](add-tagged-error.md) where domain-specific failures arise

## 4. UI routes

Run [add-route.md](add-route.md) for each page. Auth-gate at the loader level.

## 5. Forms

- Effect Schema in `app/lib/schemas/<feature>.ts`
- `react-hook-form` + `effectResolver` from `@hookform/resolvers/effect-ts`
- Surface field errors via shadcn `<FormMessage />`
- Translations in `app/locales/en/<namespace>.json`
- Route declares `handle = { i18n: ["<namespace>"] }`

## 6. i18n

- New namespace? Add to `app/i18n/i18n.d.ts` `CustomTypeOptions`
- Validation messages go in `validation.json` (use Effect Schema annotations to surface keys)
- Test that translations load on the route (manual `bun run dev` or e2e)

## 7. Tests + verification

- **Unit** (required): every new schema, helper, repository, service. See [`.brain/codebase/testing.md`](../codebase/testing.md)
- **Feature verification** (required for user-visible features): spawn the [`feature-verifier`](../../.claude/agents/feature-verifier.md) sub-agent with the feature slug + golden path + one error path. It walks the live app with the Playwright CLI (throwaway headless script run via `bun`), screenshots each step, and writes `.brain/features/<slug>/verifications/<date>.md` (see [`features/index.md`](../features/index.md)). Verdict must be PASS. Link the doc from `features/<slug>/<slug>.md`.
- **E2E smoke** (only if critical-path): if this flow is important enough to guard against future regressions in CI, add/extend a thin spec in [`e2e/`](../../e2e/). Not one-per-feature — CI runs these on every PR.

## 8. Update brain

| Touched | Update |
|---------|--------|
| New table | `data-models.md` |
| New binding | `architecture.md`, `integrations.md`, `cloudflare.md` |
| New service | `services.md`, `integrations.md` |
| New tRPC | `api.md`, `routes.md` |
| Auth/RBAC | `security.md`, `user-journeys.md` |
| New helper | `library.md` |
| Always | `features/<slug>/<slug>.md`, `CHANGELOG.md` |

## 9. Verify

```bash
bun run typecheck
bun run test
bun run test:e2e   # smoke specs (regression net)
bun run build      # catches CF Workers compat issues
```

Then feature verification (UI features): `feature-verifier` sub-agent → PASS + doc in `.brain/features/<slug>/verifications/`.

## Definition of done

- [ ] Feature memo in `.brain/features/<slug>/<slug>.md` (not just stub — every section filled)
- [ ] `scripts/seed-preview.ts` extended if the feature added a table or user-visible data
- [ ] All five non-negotiables observed (Effect, Schema, tagged errors, tests, no Node)
- [ ] CHANGELOG entry with date + scope
- [ ] typecheck + unit + e2e smoke + build all green
- [ ] Feature verification doc PASS in `.brain/features/<slug>/verifications/` (via `feature-verifier`), linked from feature memo

## Anti-patterns

- ❌ Building UI before persistence + procedure — hides data shape decisions until the end
- ❌ Inline-only feature (no `.brain/features/<slug>/<slug>.md`) — invisible to next agent
- ❌ Swallowing errors with generic `INTERNAL_SERVER_ERROR` instead of domain-specific tagged errors
- ❌ Skipping i18n — hardcoded English strings in JSX
