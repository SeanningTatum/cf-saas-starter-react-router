# Codebase — Index

How we write code in this repo. Code-level patterns, conventions, helpers, test pattern, i18n setup. **Read these before writing a repository, tRPC procedure, schema, or test.**

## Files

| File | Covers | Read when |
|------|--------|-----------|
| [`effect-ts.md`](effect-ts.md) | **Programming model.** Non-negotiables, repo pattern, tRPC procedure, Schema, tagged errors, what-not-to-do | Every code change. Default reading. |
| [`testing.md`](testing.md) | Vitest + @effect/vitest, `makeTestDatabase` stub layer, repository test pattern | Writing any helper or repository test |
| [`i18n.md`](i18n.md) | remix-i18next setup, key files, namespaces, conventions, adding new language | Adding/editing UI strings or supporting a new locale |
| [`api.md`](api.md) | tRPC routes, auth endpoints, file upload API, procedure types, context object | Adding/calling a tRPC route |
| [`features.md`](features.md) | Authentication, Admin Dashboard, Documentation, File Upload, Analytics — feature-level overview | Onboarding to a feature area before drilling into code |

## Five non-negotiables

1. **Effect TS is default.** No `throw`, no `try/catch` outside `Effect.tryPromise`.
2. **Effect Schema for all validation.** No Zod.
3. **Tagged errors** in `app/models/errors/`. Map in `app/lib/effect-trpc.ts`.
4. **Unit test for every helper and repository.**
5. **Cloudflare Workers, not Node.** Bindings via `CloudflareEnv` Tag. Never `process.env`.

Full detail: [`effect-ts.md`](effect-ts.md).

## Important things to look at

- `effect-ts.md` repo + tRPC procedure code blocks — copy-paste starting points
- `effect-ts.md` tagged-error mapping table — every new error must register there
- `testing.md` `makeTestDatabase` example — how to stub Drizzle in unit tests
- `api.md` for the live tRPC route surface

## Pair with

- [`../rules/`](../rules/) — short-form rules (lint-style) per domain
- [`../high-level-architecture/`](../high-level-architecture/) — the "why" behind the patterns

## Update triggers

- New helper in `app/lib/` → add a section here if it's broadly used; always add `*.test.ts` to the sibling `__tests__/` directory
- New convention adopted (logging, retries, cache invalidation) → document here
- Pattern deprecation → flag with `> DEPRECATED` block + replacement pointer
