# Feature: Preview Deployments

_Last updated: 2026-07-11_
_Status: shipped_

## Purpose
Per-PR preview deployments on Cloudflare Workers. Every PR gets a stable, isolated preview URL backed by its own worker/D1/R2/Workflow resources, so reviewers can exercise real changes without touching production or staging state.

## When It's Used
- PR opened / updated against `main` → GitHub Actions builds with `CLOUDFLARE_ENV=preview` and uploads a version aliased `pr-<N>`.
- Reviewer opens the sticky PR comment URL: `https://pr-<N>-<worker>-preview.<subdomain>.workers.dev`.
- PR closed → `.github/workflows/preview-cleanup.yml` deletes the PR's dedicated D1 database. Worker versions themselves need no teardown — they age out naturally (preview aliases capped at 1000).

## How It Works
Narrative (shipped — verified end-to-end):

- `wrangler.jsonc` gets a new `env.preview` block. Cloudflare environments do **not** inherit bindings from the top-level config, so every binding used by the app (D1, R2, Workflow) must be redeclared under `env.preview` pointing at preview-only resources:
  - D1: `<name>-db-preview`
  - R2: `<name>-bucket-preview`
  - Workflow: `<name>-example-workflow-preview`
- Build: `CLOUDFLARE_ENV=preview` must be set at **build time**, not deploy time. The Vite Cloudflare plugin flattens the selected environment into `build/server/wrangler.json` (the config that actually gets deployed). Critically, `wrangler deploy --env preview` does **not** work for this flow — the environment selection has to happen during the Vite build, not via a wrangler CLI flag.
- Deploy: after the preview build, CI runs `wrangler versions upload --preview-alias pr-<N>`, which produces the stable aliased URL above (stable across re-uploads for the same PR number, unlike the default random version URL).
- CI: `.github/workflows/preview.yml` — gated on repo var `CLOUDFLARE_ACCOUNT_ID` + secret `CLOUDFLARE_API_TOKEN` (workflow should no-op / skip cleanly if these aren't configured on a fork). Posts/updates a sticky PR comment with the preview URL. Worker versions need no teardown step — version aging + the 1000-alias cap handle them; the per-PR D1 is deleted by `preview-cleanup.yml` on PR close.
- Data: **per-PR D1**. `scripts/ci/setup-preview-db.ts <N>` runs first in CI: it creates `<name>-db-pr-<N>` if missing (falls back to `d1 info` when it already exists) and patches the CI checkout's `wrangler.jsonc` so `env.preview`'s `DATABASE` binding points at it — the patch is never committed. CI then applies migrations (`--env preview --remote` resolves to the patched DB) before uploading the version. Because bindings are attached **per-version**, one preview worker serves all PRs, each version carrying its own D1 binding. R2 stays shared across previews (wrangler can't delete non-empty buckets → per-PR buckets would orphan). Note: D1 free plan caps at 10 databases — per-PR DBs assume paid; on free, revert preview.yml's provision step to the shared `-db-preview` DB.
- Auth: Better Auth's `baseURL` is derived per-request in `workers/app.ts` rather than pinned to a static origin, so preview subdomains work correctly without needing every `pr-<N>-...` origin added to `trustedOrigins`.
- Secrets: `BETTER_AUTH_SECRET` (and any other env-scoped secret) must be set specifically for the `preview` environment (`wrangler secret put ... --env preview`) — it is not inherited from production. `wrangler secret put` refuses when the worker's latest *uploaded* version isn't the *deployed* one (true for the preview env, which only ever gets version uploads, never `wrangler deploy`); `scripts/first-time-setup.ts` detects this and automatically falls back to `wrangler versions secret put ... --env preview`, which creates a new version carrying the secret that subsequent version uploads inherit.

Empirically verified: preview URLs resolve and serve traffic correctly with the Workflows binding present in `env.preview`; per-PR D1 binding confirmed via `pr-999` test upload (`env.DATABASE (cf-saas-starter-react-router-db-pr-999)` in the uploaded version manifest); full signup flow returns 200 on the alias URL `https://pr-test-cf-saas-starter-react-router-preview.royal-snowflake-2464.workers.dev` with the user row written to the preview D1, and prod signup independently verified 200 (2026-07-11).

### Persistence details
- D1: **per-PR** database `<name>-db-pr-<N>` — created + migrated **and seeded** by CI on PR open and every push (`.github/workflows/preview.yml` steps "Migrate per-PR D1" then "Seed per-PR D1", `bun scripts/seed-preview.ts --preview`), deleted on PR close by `preview-cleanup.yml`. Seeding is idempotent (`INSERT OR IGNORE`, fixed `seed-*` ids) so it's safe on every synchronize. `bun run teardown` additionally sweeps any orphaned `-db-pr-*` databases (via `wrangler d1 list --json`). The shared `<name>-db-preview` still exists for manual preview work (`bun run db:migrate:preview`, `deploy:preview`).
- Seed fixtures: three Better Auth email/password accounts, password `Password123!` for all — `admin@preview.local` (role `admin`), `user@preview.local` (role `user`), `banned@preview.local` (role `user`, `banned = true`, for ban-UI testing). Same fixtures seed local D1 via `bun run db:seed`. See [`.brain/rules/repository.md`](../../rules/repository.md) ("Seed data") for the idempotency contract and the rule that new tables/user-visible data must extend `scripts/seed-preview.ts` in the same diff.
- R2: dedicated preview bucket `<name>-bucket-preview`, isolated from production but **shared across PRs** (non-empty buckets can't be deleted by wrangler, so per-PR buckets would orphan).
- Workflow: dedicated preview workflow binding `<name>-example-workflow-preview`.
- Per-PR D1 isolation, shared R2 — acceptable for review purposes; not a production data path.

### Testability
Not unit/e2e tested in the Vitest/Playwright sense — this is infra/CI, not application code. Verification is manual/empirical: preview URL serves traffic with Workflows binding attached; per-PR D1 binding confirmed on a real version upload (`pr-999`); live signup smoke-tested 200 on both the alias URL (`pr-test`, preview D1 row written) and prod. CI-workflow-level verification (PR opened → workflow run green → sticky comment present → URL reachable) is exercised naturally on the first real PR against `main`.

## Key Files

| File | Role |
|------|------|
| `wrangler.jsonc` | Adds `env.preview` block redeclaring D1/R2/Workflow bindings for preview; D1 entry is repointed per-PR in CI (patch never committed) |
| `scripts/ci/setup-preview-db.ts` | CI-only, non-interactive: create/find `<name>-db-pr-<N>`, patch checkout's `wrangler.jsonc` D1 binding |
| `scripts/seed-preview.ts` | Deterministic seed fixtures (admin/user/banned, `INSERT OR IGNORE`) for local D1 (`bun run db:seed`) and per-PR preview D1 (`bun run db:seed:preview`, run by CI) |
| `.github/workflows/preview.yml` | CI: provision per-PR D1, migrate it, seed it, build with `CLOUDFLARE_ENV=preview`, `wrangler versions upload --preview-alias pr-<N>`, sticky PR comment (includes test-account credentials) |
| `.github/workflows/preview-cleanup.yml` | CI: on PR close, delete `<name>-db-pr-<N>` (tolerates absent DB) |
| `scripts/teardown.ts` | Orphan sweep: deletes any leftover `<name>-db-pr-*` databases during full teardown |
| `workers/app.ts` | Better Auth `baseURL` derived per-request so preview origins work without `trustedOrigins` changes |
| `build/server/wrangler.json` | Generated (not hand-edited) — Vite Cloudflare plugin's flattened preview config, actually deployed by wrangler |

## Dependencies
- Cloudflare bindings: D1 (per-PR `<name>-db-pr-<N>`; shared `<name>-db-preview` for manual work), R2 (`<name>-bucket-preview`, shared), Workflows (`<name>-example-workflow-preview`)
- Vite Cloudflare plugin (build-time env flattening via `CLOUDFLARE_ENV`)
- Wrangler CLI (`versions upload --preview-alias`)
- GitHub Actions: repo var `CLOUDFLARE_ACCOUNT_ID`, secret `CLOUDFLARE_API_TOKEN`
- Better Auth (per-request `baseURL` derivation in `workers/app.ts`)
- No dependency on other features (infra-level; `dependencies: []` in `feature_list.json`)

## Tagged Errors
None yet — infra/CI concern, no application-level tagged errors introduced.

| Error | Where raised | tRPC code |
|-------|--------------|-----------|
| n/a | n/a | n/a |

## Changelog

| Date | Type | Description |
|------|------|-------------|
| 2026-07-10 | feature | Scoped + started: `env.preview` wrangler block design, build-time `CLOUDFLARE_ENV` flattening approach, `wrangler versions upload --preview-alias` deploy path identified as the working mechanism (env-flag deploy does not work). Empirically confirmed preview URL serves traffic with Workflows binding. CI workflow and full end-to-end run still outstanding. |
| 2026-07-11 | feature | Per-PR D1 isolation: `scripts/ci/setup-preview-db.ts` creates `<name>-db-pr-<N>` and patches the CI checkout's `wrangler.jsonc`; `preview-cleanup.yml` deletes the DB on PR close; `teardown.ts` gained an orphan `-db-pr-*` sweep. Bindings are per-version, so one preview worker serves all PRs. R2 remains shared. |
| 2026-07-11 | feature | **Shipped.** Live end-to-end verification complete: per-PR D1 binding confirmed on `pr-999` version upload, alias-URL signup 200 with user row written to preview D1 (`pr-test` alias), prod signup independently verified 200. Secrets confirmed settable via `wrangler secret put --env preview` with `wrangler versions secret put` fallback when the latest version isn't the deployed one (setup script now handles both automatically). |
| 2026-07-13 | feature | Added `scripts/seed-preview.ts`: deterministic admin/user/banned fixtures (`Password123!`) seeded into local D1 (`bun run db:seed`) and per-PR preview D1 (`bun run db:seed:preview`, wired into `preview.yml` after migrations). Idempotent via `INSERT OR IGNORE` + fixed `seed-*` ids. Codified "seed evolves with features" rule in `rules/repository.md`, `add-db-table.md`, `add-feature.md`, CLAUDE.md/AGENTS.md.
