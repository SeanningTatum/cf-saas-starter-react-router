# CI and deploy pipelines

Four workflows live in `.github/workflows/`. Deploy and preview stay off until you set up your Cloudflare account. A repo that is not set up ends those runs as skipped with a one-line notice, and the run stays green.

## What each workflow does

| Workflow | Runs on | What it does |
|----------|---------|--------------|
| `ci.yml` | every push to `main`, every pull request | typecheck, tests, build, e2e smoke |
| `deploy.yml` (Deploy Production) | CI finished green on a push to `main` | when a migration is pending, records a D1 restore point and exports the database ([rollback](rollback.md)); then migrates the production D1 database, builds, runs `wrangler deploy` |
| `preview.yml` (Preview Deploy) | a pull request opened, updated or reopened | gives the PR its own D1 database, seeds it, uploads a Worker version, comments the URL |
| `preview-cleanup.yml` (Preview Cleanup) | a pull request closed | deletes the PR's D1 database |

Each of the three Cloudflare workflows starts with a `readiness` job that holds no secret value. It runs `scripts/ci/deploy-gate.ts`, which decides whether the repo is set up. When it is not, the later jobs are skipped and the notice says why (`::notice::<Workflow> skipped: <reason>`). The reasons live in that script. The deploy job adds one more skip: no `CLOUDFLARE_API_TOKEN` in the `production` environment.

The gate also warns (the run still passes) when a repo-level `CLOUDFLARE_API_TOKEN` secret exists: pull-request jobs can read repo-level secrets. Move it to the `production` environment and delete the repo-level one.

The `migrations` gate is part of `./scripts/verify.sh`. It checks the SQL in `drizzle/` for unsafe statements, edits to merged migrations, and drift from `app/db/schema.ts`. The rule and the gate are in [Rolling back](rollback.md#what-the-gate-checks).

A run that is set up but fails is a real failure. The usual cause is a token without D1 rights: the log says `Authentication error`, and the workflow adds a line naming the fix.

## Variables and secrets

| Name | Where it lives | Who reads it |
|------|----------------|--------------|
| `CLOUDFLARE_ACCOUNT_ID` | repo variable | deploy; also preview and cleanup when `CLOUDFLARE_PREVIEW_ACCOUNT_ID` is unset |
| `CLOUDFLARE_PREVIEW_ACCOUNT_ID` | repo variable, optional | preview and cleanup; use it for a separate preview account |
| `CLOUDFLARE_D1_DATABASE_ID` | repo variable, optional | deploy only; patched into the CI checkout's `wrangler.jsonc` |
| `D1_BACKUP_BUCKET` | repo variable, optional | deploy only; names a private R2 bucket for the pre-migration export ([rollback](rollback.md#owner-steps-to-turn-the-export-on)) |
| `CLOUDFLARE_API_TOKEN` | `production` environment secret | the deploy job only |
| `CLOUDFLARE_PREVIEW_API_TOKEN` | repo secret | the preview and cleanup jobs, on the single steps that call Cloudflare |
| `PREVIEW_SEED_SECRET` | repo secret (and your local `.env`) | the seed step of the preview job; `--print-password` on your machine |
| `PRODUCTION_SEED_SECRET` | not stored in GitHub; set in your shell | only when you run the forced production seed by hand |

The preview jobs never read `CLOUDFLARE_API_TOKEN`. The preview `readiness` job only tests whether it is set.

## Who can read what

- **Preview token and `PREVIEW_SEED_SECRET`:** anyone who can push a branch to this repo can read them, because a pull request can edit the workflow that uses them. That is why they are separate from the production token, and why a second Cloudflare account is the strong setup (below).
- **Production token:** a `production` environment secret is out of reach of pull-request code only once that environment is protected: a required reviewer, and deploys only from the default branch. Until then, a branch in this repo can add `environment: production` to a workflow of its own and read the token. The owner applies the protection with `bun run scripts/repo-rules.ts --apply` (from another pull request, #67; see `docs/ci/repo-rules.md`, added by #67). Protect the environment first, then add the token.

## Turn on production deploys

1. Run `bun run setup`. It creates the Cloudflare resources and writes their real ids into `wrangler.jsonc`. Commit that file. (This template keeps placeholder ids committed. If your repo does too, do step 6 instead.)
2. Set the repo variable `CLOUDFLARE_ACCOUNT_ID` (Settings, Secrets and variables, Actions, Variables).
3. Protect the `production` environment (see [Who can read what](#who-can-read-what)): a required reviewer, and deploys only from the default branch.
4. Create a Cloudflare API token ([Create the tokens](#create-the-tokens)).
5. Add it as the secret `CLOUDFLARE_API_TOKEN` in the `production` environment (Settings, Environments, production). `bun run setup` can do steps 2 and 5 when the GitHub CLI is available; it asks you to protect the environment first. It never replaces an environment that already exists.
6. Optional, for a repo that keeps placeholder ids committed: set the repo variable `CLOUDFLARE_D1_DATABASE_ID` to your production database id. The deploy job writes it into the checkout; the file in git does not change.
7. Delete any old repo-level `CLOUDFLARE_API_TOKEN` secret.
8. Optional: turn on the pre-migration database export. Follow the owner steps in [Rolling back](rollback.md#owner-steps-to-turn-the-export-on). Without it, the deploy still records a Time Travel bookmark.
9. Push to `main`. After CI passes, Deploy Production runs.

## Turn on previews

1. Set `CLOUDFLARE_ACCOUNT_ID`, or `CLOUDFLARE_PREVIEW_ACCOUNT_ID` for a separate preview account (strongly advised).
2. Create a second token ([Create the tokens](#create-the-tokens)) and add it as the repo secret `CLOUDFLARE_PREVIEW_API_TOKEN`.
3. Add the repo secret `PREVIEW_SEED_SECRET`: any random string of 16 or more characters. `bun run setup` generates one and also writes it to your local `.env`.
4. Open a pull request. Preview Deploy runs and comments the URL.

## Create the tokens

Go to https://dash.cloudflare.com/profile/api-tokens and create one token for production and one for previews:

1. Start from the "Edit Cloudflare Workers" template.
2. Add Account, D1, Edit. The template alone cannot run migrations.
3. Under Account Resources, limit the token to one account.

Cloudflare scopes the Workers and D1 permissions to an account, not to one Worker or one database. A preview token in the same account as production can therefore still reach production resources. A separate token keeps pull-request code away from the production token, but it does not wall off production data.

The strong setup is a second Cloudflare account for previews. Create the preview token there, set `CLOUDFLARE_PREVIEW_ACCOUNT_ID` to that account's id, and create the `preview` Worker and R2 bucket there (the bucket named in `wrangler.jsonc`, then `bun run deploy:preview` with that account's id). Then a leaked preview token reaches nothing in production.

## Preview passwords

Preview databases are seeded with three test accounts (`scripts/seed-preview.ts`). This repo is public, so a password in the repo would open every preview. Each preview gets its own password instead:

- It is the first 24 characters of base64url(HMAC-SHA256(key = `PREVIEW_SEED_SECRET`, message = `preview:<PR>`)).
- Each push writes it again with an `UPDATE`, so rotating the secret changes the passwords of live previews on their next push.
- The PR comment and the CI log never show it.
- Print it on your machine, with the secret in your environment (`bun run setup` saved it to `.env`):

  ```bash
  PREVIEW_SEED_SECRET=... bun scripts/seed-preview.ts --print-password --pr <N>
  ```

The production seed (`--remote --force-production`, run by hand) uses its own `PRODUCTION_SEED_SECRET` and the message `production:`. It never uses the preview secret, because pull-request code can read that one.

Why a derived password and not Cloudflare Access: previews stay open to any reviewer or agent who holds the secret, there is no Zero Trust setup, and the password rotates with the secret. Cloudflare Access can sit in front of previews as well; the two do not conflict.

Local development keeps `Password123!` (`bun run db:seed`). The seed refuses to use it for a preview or production target.

## One Bun version

`.bun-version` holds the single Bun version. Every `oven-sh/setup-bun` step reads it, and `scripts/__tests__/github-workflows.test.ts` fails if a workflow sets `bun-version` itself. To upgrade Bun, edit that one file.
