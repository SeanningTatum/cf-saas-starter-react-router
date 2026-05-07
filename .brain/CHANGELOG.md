# Brain Changelog

High-level project + brain changes. **Not a code changelog** (see `git log` for that). This tracks:

- Architectural shifts (e.g. "migrated to Effect TS")
- New features shipped (with link to `features/<slug>.md`)
- Brain restructures (folder splits, doc rewrites)
- Decisions reversed
- External constraint changes (legal, vendor, deadline) sourced from `transcripts/` or `emails/`

## Conventions

- Newest entry on top
- Date format: `YYYY-MM-DD`
- One entry per change. Use the type tags: `feature` `bugfix` `refactor` `decision` `brain` `chore`
- Link out: `See .brain/features/<slug>.md`, `See .brain/transcripts/<file>.md`, `See PR #<n>`

## Entries

| Date | Type | Description |
|------|------|-------------|
| 2026-05-07 | brain | **Harness-engineering bookends + run logs.** Added `.brain/recipes/00-before-task.md` (init phase: frame task, read brain, capture baseline, optionally open run note) and `.brain/recipes/99-verify-done.md` (termination check: typecheck/test/e2e/build + brain coherence + non-negotiables sweep). New `.brain/runs/` folder w/ `index.md` + `_TEMPLATE.md` for per-task continuity across sessions/compactions. `.claude/commands/verify-done.md` exposes the termination check as `/verify-done` slash command. CLAUDE.md / AGENTS.md / README.md updated. Closes course gaps from walkinglabs harness-engineering lectures L05 (continuity), L06 (init phase), L09 (premature victory), L11 (observability). |
| 2026-05-07 | bugfix | **Closed admin auth gap.** Added loader to `app/routes/admin/_layout.tsx` requiring `session.user.role === "admin"` (else `redirect("/dashboard")`). Removes one of the 5 known security gaps in `security.md`. |
| 2026-05-07 | refactor | Deduped Better Auth instantiation. `app/routes/api/auth.$.ts` now reuses `context.auth` (was creating a fresh instance per loader+action). Worker entrypoint remains the single creation site. |
| 2026-05-07 | chore | Dropped `nodejs_compat` from `wrangler.jsonc` — no Node API usage in worker bundle (custom logger, no pino import). Smaller worker size, faster cold start. |
| 2026-05-07 | chore | `.gitignore` now excludes `.claude/settings.local.json` + `.claude/.credentials*` to prevent leaking per-machine permissions/secrets. Added `.cursor/` (no longer tracked). |
| 2026-05-07 | chore | Replaced LLM-call commit hook (`claude -p ...`) with deterministic shell reminder `.claude/hooks/brain-reminder.sh` that maps staged paths → relevant `.brain/` docs. Cheap, fast, never blocks. |
| 2026-05-07 | refactor | Removed Effect TS leaks: `app/trpc/router.ts` `.then(...)` → `Effect.map`; `app/services/session.ts` `Effect.promise` → `Effect.tryPromise`+`ExternalServiceError`; `app/routes/api/upload-file.ts` `throw new Response` → `Effect.fail(ValidationError)` via `runProcedure`; `app/trpc/routes/admin.ts` 3× `throw new TRPCError` → `Effect.fail(ValidationError)`. All flow through `tagToTRPC` now. |
| 2026-05-07 | brain | Added `.brain/recipes/` runbooks: `add-trpc-endpoint`, `add-db-table`, `add-tagged-error`, `add-cf-binding`, `add-feature`, `add-route`, `add-service`. Each is a paste-able checklist with code snippets, brain updates, and definition of done. CLAUDE.md + AGENTS.md updated to surface recipes in index map. |
| 2026-05-07 | feature | Service unit tests added under `app/services/__tests__/` for `cloudflare`, `bucket`, `workflows`, `session`, `auth`. Closes the "no service tests" gap; total now 123 unit tests across 16 files. |
| 2026-05-07 | chore | Pre-commit gate via no-dep `core.hooksPath = .githooks`. Hook runs `bun run typecheck && bun run test` only if TS/JS files staged. `npm run hooks:install` wired into `postinstall`. Skip with `SKIP_HOOKS=1`. |
| 2026-05-07 | bugfix | Fixed pre-existing typecheck breakage in `app/components/ui/resizable.tsx` after `react-resizable-panels` v4 upgrade renamed `PanelGroup` → `Group`, `PanelResizeHandle` → `Separator`. |
| 2026-05-07 | refactor | Test files moved from co-located `*.test.ts` next to source into sibling `__tests__/` subfolders (`app/lib/__tests__/`, `app/lib/schemas/__tests__/`, `app/repositories/__tests__/`). 11 test files moved, all `from "./x"` imports rewritten to `from "../x"`. Vitest config unchanged (`app/**/*.test.ts` glob already recursive). All 113 tests still pass. `library.md` + `testing.md` + `repository.md` + `errors.md` + `effect-ts.md` + `codebase/index.md` + `api.md` + 4 feature files updated to reflect new layout. |
| 2026-05-07 | feature | Removed admin docs viewer feature. Deleted `app/routes/admin/docs.tsx` + `app/components/markdown-renderer.tsx` + sidebar entry + `nav.docs` i18n key + `/admin/docs/...` route. Uninstalled `react-markdown`, `shiki`, `mermaid`, `remark-gfm`, `remark-directive`, `unist-util-visit`. `docs/` source folder kept as project notes. Brain: deleted `features/admin-docs-viewer.md`, removed entries from `features/index.md`, `codebase/features.md`, `codebase/api.md` route table, `user-journeys.md`, `integrations.md` markdown rendering section, `high-level-architecture/index.md` integrations row, CLAUDE.md + AGENTS.md overview line. |
| 2026-05-07 | brain | Promoted 5 features to per-feature docs (`features/{authentication,admin-dashboard,admin-docs-viewer,file-upload,analytics}.md`) with full memory + tagged-error tables; populated `features/index.md`. |
| 2026-05-07 | brain | Verified all cited service shapes against source. Fixed `Bucket` repo method names (`upload/get/remove/list`, not `put/delete`), `Logger` Layer shape, `Workflows.triggerExample`, `effectResolver` re-export, `Effect.tryPromise` vs `Effect.promise` divergence in `createTRPCContext`. |
| 2026-05-07 | brain | Fixed redirect targets in `user-journeys.md` (`/dashboard`, not `/admin`); `i18n.md` namespaces (added `dashboard`) + single-locale (`en`) state; `docs/` categories (8 folders, not 5); upload route response shape (`{ success, key }`). |
| 2026-05-07 | brain | Anchored `cloudflare.md` workflow example to real `ExampleWorkflow` class. Added `WorkflowTriggerError` to `effect-ts.md` mapping table. |
| 2026-05-07 | decision | Audited `/admin/_layout.tsx` and `/api/upload-file` — flagged 5 known security gaps in `security.md` "Known gaps" (admin layout no auth gate, upload no auth, no file validation, no public URL, no security headers). To close in follow-up PRs. |
| 2026-05-07 | brain | Realigned all docs to current codebase. `high-level-architecture/{architecture,security,integrations,data-models}.md` and `codebase/api.md` rewritten to drop Zod, raw `db: Database` repo signatures, `TRPCError`-throwing repos, and KV session storage (sessions are in D1). `rules/{services,library,frontend}.md` trimmed to remove Stripe/PostHog/Resend/AI sections — those integrations are not present in the repo. `codebase/features.md` now redirects detailed memory to `features/<slug>.md`. CLAUDE.md + AGENTS.md drop nonexistent `agents/` `skills/` `plans/` folders (those live in shared plugins). `rules/index.md` gains old→new rule rename map. `emails/index.md` broken pointer fixed. |
| 2026-05-07 | brain | Consolidated `.brain/rules/` from 29 single-topic rules to 7 layer-aligned rules: `frontend.md`, `cloudflare.md`, `repository.md`, `services.md`, `routes.md`, `library.md`, `errors.md`. Dropped meta rules (`docs.md`, `context-md.md`, `general-rules.md`, `pull-request.md`, `frontend-task.md`, `fullstack-task.md`). CLAUDE.md + AGENTS.md updated to point to layer rules. |
| 2026-05-07 | brain | Reorganized brain to `.brain/` root with `high-level-architecture/`, `codebase/`, `rules/`, `features/`, `transcripts/`, `emails/`. Migrated `.cursor/context/` and `.cursor/rules/` content. Deleted `.cursor/`. CLAUDE.md and AGENTS.md now point to `.brain/`. |
| 2026-05-07 | refactor | Migrated repo to Effect TS — all repositories now `Effect.Service`, validation via Effect Schema, errors are `Data.TaggedError`. Removed Zod. See `.brain/codebase/effect-ts.md`. |
| 2026-05-05 | feature | i18n + dark mode added. See `.brain/codebase/i18n.md`. |
