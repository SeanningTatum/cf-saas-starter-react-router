# CI and deploy pipelines

Nine workflows live in `.github/workflows/`. Deploy and preview stay off until you set up your Cloudflare account. A repo that is not set up ends those runs as skipped with a one-line notice, and the run stays green.

## What each workflow does

| Workflow | Runs on | What it does |
|----------|---------|--------------|
| `ci.yml` | every push to `staging` or `production`, every pull request | typecheck, lint, tests, build, e2e smoke; on a PR into `staging` or `production` also the Effect diagnostics, and the size table and Lighthouse in one comment ([reading it](#reading-the-size-table)); on a stacked PR only the lean job ([which checks run where](#which-checks-run-where)) |
| `pr-body.yml` (PR body) | every pull request, opened, edited, updated or reopened | fails a PR that changes shipped code and whose body has no size table ([reading it](#reading-the-size-table)) |
| `codeql.yml` (CodeQL) | every push to `staging` or `production`, every pull request into the default branch or `production`, and Mondays | reads the source for injection and workflow mistakes |
| `production-guard.yml` (Production Guard) | a pull request into `production` | fails unless the pull request comes from this repo's `staging` |
| `release.yml` (Release) | every push to `production` | picks the next version, tags the commit, creates the GitHub release |
| `deploy.yml` (Deploy Production) | CI finished green on a push to `production` | migrates the production D1 database (first saving a [restore point](rollback.md)), builds, waits for the environment's reviewer, uploads a version with its [release version and environment](../agents/error-reporting.md#environment) and moves traffic 10%, 50%, 100% with a smoke check after each step, rolling back on a failure ([automatic rollback](rollback.md#automatic-rollback)); a failure comments on the open "Production deploy failed" issue |
| `deploy-staging.yml` (Deploy Staging) | CI finished green on a push to `staging` | migrates the staging D1 database, deploys the staging Worker with its release, smoke-checks `/healthz`, runs the `@deployed` e2e specs against it ([staging](#staging)) |
| `preview.yml` (Preview Deploy) | a pull request into the default branch or `production`, opened, updated or reopened | gives the PR its own D1 database, seeds it, uploads a Worker version (with its [release version and environment](../agents/error-reporting.md#environment)), comments the URL |
| `preview-cleanup.yml` (Preview Cleanup) | a pull request closed | deletes the PR's D1 database |

## Which checks run where

A stacked PR is one whose base is neither the default branch nor `production`: a ticket PR into a wave branch, or a PR into the branch of the PR below it. It gates nothing, so it gets one lean job. The full suite runs where it gates a merge.

| Check | Stacked PR | PR into the default branch | PR into `production` | Push to either |
|-------|------------|----------------------------|----------------------|----------------|
| Lean (stacked PR, typecheck + lint + unit) | yes | — | — | — |
| Baseline (typecheck + test + harness-check) | — | yes, required | yes, required | yes |
| Build (Cloudflare Workers) | — | yes, required | yes, required | yes |
| E2E smoke (Playwright) | — | yes, required | yes, required | yes |
| Effect diagnostics (`bun run lint:effect`) | — | yes | yes | — |
| CodeQL | — | yes | yes | yes (and Mondays) |
| Preview Deploy | — | yes | yes | — |
| Size (against the base branch) | — | yes | yes | — |
| Lighthouse (mobile, against the base branch) | — | yes | yes | — |
| Size and Lighthouse comment | — | yes, unless the PR comes from a fork | yes | — |
| PR body (size table) | yes | yes | yes | — |
| PR title (Conventional Commits) | yes | yes | yes | — |
| Source branch is staging | — | — | yes, required | — |
| Greptile (`greptile.json`) | — | yes | yes | — |

- The lean job runs `./scripts/verify.sh --lean`: typecheck, `bun run lint` (Biome, the house linter, import cycles and dead code), the house linter over the whole tree with its shrink-only baseline (and its self-test), and every unit test. It leaves out the migration check, the harness gate, the secret scan, the package audit (it reads the network), the coverage floors, the build, e2e, the code scan and the preview. All of those run on the roll-up; the Baseline job runs the coverage floors as its last step ([coverage floors](../agents/harness.md#coverage-floors)).
- The jobs choose with a job-level `if:` that compares `github.base_ref` with `github.event.repository.default_branch` and `production`, so a fork with another default branch name needs no edit. `scripts/__tests__/github-workflows.test.ts` reads the workflow files and proves which jobs run for each base.
- GitHub counts a skipped job as passed. A stacked PR that is later retargeted to the default branch keeps the skipped results of its last push, and retargeting starts no new run. After a retarget, push a commit (or close and reopen the PR) so the full suite runs before the merge. `ship-feature` never retargets a stacked PR onto the default branch: the roll-up is a new PR.
- `greptile.json` names `staging` and `production` in `includeBranches`, since Greptile has no word for "the default branch". A fork with another default branch name edits that list.
- Locally, `./scripts/verify.sh --changed [base]` is the stacked counterpart: see [Gates](../agents/harness.md#gates).

## Reading the size table

Every PR that changes shipped code (`app/` or `workers/` outside `__tests__/` and `*.test.ts(x)` files, `package.json` or `bun.lock`) carries a size table in its body; one that changes none says "No shipped code changed." `ship-feature` writes it when it opens a PR. By hand:

```bash
bun run size                                  # this checkout: one build, one column
bun run size --base origin/staging            # base, this change and the difference
bun run size --base origin/staging --pr-body  # the PR body section, table or sentence
bun run size --json size.json                 # save a report; pass it later as --base size.json
```

`--base` builds the base commit in a temporary worktree and caches the result by commit in `node_modules/.cache/size/`, so a stack measures each base once. Every number is in bytes, gzip:

- **Worker upload**: what `wrangler deploy --dry-run` reports. It is not sent to the browser; a big jump slows cold starts and nears Cloudflare's script size limit.
- **entry.client and root chunks**: the JavaScript every page loads.
- **`/path` first-load JS and CSS**: everything the browser fetches before that page can run: the entry, each route from the root down, and their imports, each file counted once. Read from the React Router manifest in `build/client/assets/manifest-*.js`.

The line under the table turns the largest first-load change into time: the extra bytes over Lighthouse's slow 4G link (1,638.4 kbit/s), `ms = bytes × 8 ÷ 1,638.4`. 10 KB is about 49 ms. It is transfer time alone, before the browser parses and runs the code. A page that exists on one side only has nothing to compare with, so the line names it as new or removed instead of counting it.

`PR body (size table)` fails a PR that changes shipped code with no filled comparison table (the header row and a Worker row with numbers; a table inside a code fence does not count), and one whose body claims "No shipped code changed." when it does. It reads the body and the list of changed files, so it re-runs in seconds when you edit the body.

On a PR into `staging` or `production`, CI measures the size itself against the base branch and runs Lighthouse (`bun run lighthouse --base <ref>`): each ref is built in its own worktree with a seeded local D1 and a `.dev.vars` holding `BETTER_AUTH_URL=http://localhost:4173` and a throwaway secret, served with `vite preview`, and measured with mobile settings on `/`, `/login`, `/sign-up` and `/dashboard` (signed in as the seeded user), three runs each, the median of each number. One comment on the PR holds both tables and is edited on each push. The limits in `.github/lighthouse-limits.json` only warn for now. The HTML and JSON reports are in the run's `lighthouse` artifact for 14 days; nothing is uploaded anywhere else.

## How a change reaches production

Two long-lived branches: `staging` (the default branch) and `production`.

1. A feature pull request is squashed into `staging`. The pull request title becomes the commit subject, so write it as a Conventional Commit (`feat: ...`, `fix: ...`).
2. To release, open a pull request from `staging` into `production` and merge it with a **merge commit**. Nothing else may merge into `production`: the Production Guard check fails any other source, and the `production` ruleset allows the merge method only.
3. The push to `production` starts CI, Release and CodeQL.
4. `release.yml` runs `.github/scripts/next-version.sh`. It reads every commit since the last `vX.Y.Z` tag and chooses the bump:
   - `type!:` in a subject, or a `BREAKING CHANGE:` footer: major.
   - `feat:`: minor.
   - anything else: patch.

   It then tags the commit and creates the release with GitHub's generated notes. A re-run on a commit that already has a tag does nothing.
5. After CI passes on `production`, `deploy.yml` waits for the owner's approval on the `production` environment, then rolls that commit out in steps ([automatic rollback](rollback.md#automatic-rollback)).

`release.yml` tags on the push to `production` and does not wait for CI or the deploy, so a failed deploy still has a tag. Fix forward with a new release.

Cut a release:

```bash
gh pr create --base production --head staging --title "chore: release" --body "Release."
gh pr merge --merge <number>
```

The title of a merge-commit pull request does not pick the version: the squashed subjects inside it do.

### Why the environment says "default branch"

The deploy job starts from a `workflow_run` trigger, and a `workflow_run` run always has the default branch (`staging`) as its ref, whatever branch CI ran on. The `production` environment therefore takes deploys from runs on the default branch, even though the code it ships is `production`'s. The job checks out the tested commit by its sha, so it deploys what CI passed. Set the environment rule to the default branch, not to `production`, or the deploy never gets the token. For the same reason the deploy workflow that runs is the copy on the default branch (`staging`), not the one on `production`: a change to `deploy.yml` takes effect for the next production deploy as soon as it is on `staging`.

### How v3.0 lands

`staging` has linear history, so the long-lived `release/v3.0` branch lands as one squash commit with the title `feat!: v3.0`. A merge-commit pull request from `staging` into `production` follows. `release.yml` reads the `!` and tags `v3.0.0` (the last tag is `v2.4.0`).

### A fresh fork

A new fork has one branch (`staging`) and no rules. CI and CodeQL run on pull requests and on pushes to `staging`. Nothing deploys or releases, and every gate in `./scripts/verify.sh` passes without a `production` branch. To adopt the two-branch flow:

1. Create the branch: `git push origin staging:production`.
2. Apply the rules: `bun run scripts/repo-rules.ts --apply`.
3. Set up the `production` environment ([Turn on production deploys](#turn-on-production-deploys)).

If your default branch has another name, the simplest way is to rename it to `staging`. To keep your name instead, change it in five places: the `branches:` lines under `push:` in `ci.yml` and in `codeql.yml`, the `branches:` line under `workflow_run:` in `deploy-staging.yml`, the source check in `production-guard.yml` (`"$HEAD_REF" != "staging"`), and `includeBranches` in `greptile.json`. The wrangler environment and the GitHub environment keep the name `staging`; they name the stage, not the branch. The workflow tests read the two names from `ci.yml` and hold the other workflows to them, so a missed place fails `bun run test`.

## Commit subjects and PR titles

Every commit subject and every PR title is a Conventional Commits line: `type(scope)?!?: subject`, 100 characters at most. Release versions are computed from subjects, so a title that breaks the rule ships as a patch or breaks the version script.

Three checks read the same rule:

- the `commit-msg` hook runs commitlint on each commit you make;
- the `PR title (Conventional Commits)` job in `pr-title.yml` lints the PR title on open, edit, push and reopen, on every base branch;
- once the repo ruleset lists that job as required, a PR with a bad title cannot merge.

The types and the scopes live in `.commitlintrc.json` and nowhere else; read that file for the lists. Merge commits (`Merge pull request ...`, `Merge branch ...`) pass the hook. A PR title shaped like one does not pass the title job (`.commitlintrc.title.json` takes every rule from the first file and turns that one exception off): squashed, such a title would be a subject with no type. Body and footer lines may be as long as you like.

Four PRs carry a title the version script reads, so word each one on purpose:

| PR | Title | Why |
|----|-------|-----|
| A feature PR into `staging` or into a stacked branch | `feat(scope): ...`, `fix(scope): ...` | It is squashed, so this line is the commit the version script reads. |
| A wave roll-up into `release/v3.0` | `feat: v3.0 wave <n>, <what it brings>` (`feat!:` if it breaks something) | It is squashed into the release branch. |
| The release PR squashing `release/v3.0` into `staging` | `feat!: v3.0, <summary>` | The `!` makes a major bump. |
| `staging` into `production` | any title that passes the check, for example `chore(release): staging to production` | It is merged with a merge commit, so its own title is not read. |

Worked example: the release PR is titled `feat!: v3.0, the new starter`. It lands on `staging` as one commit with that subject. The merge-commit PR into `production` carries it, `release.yml` reads the `!`, and the tag comes out as `v3.0.0` (the last tag is `v2.4.0`). Titled `v3.0 wave 0: guardrails, trim and foundations` instead, the same commit would have read as a patch: `v2.4.1`.

The harness writes its own titles to the same rule. The architect gives each stacked PR a conventional title; `ship-feature` commits with that title and prefixes `feat: ` on one that has no type. The roll-up title takes `feat` when any stacked PR is a `feat`, else the last PR's type, and carries `!` when any stacked PR is breaking. `ship-feature` checks only the shape of a title, not the scope list: a title with an unlisted scope is caught by the `commit-msg` hook and the PR title job.

## Health route

`GET /healthz` (`app/routes/api/healthz.ts`) is public and answers one of two bodies:

| Database | Status | Body |
|----------|--------|------|
| answers `select 1` | 200 | `{"status":"up","release":"<RELEASE_VERSION>"}` |
| fails, or takes over 3 seconds | 503 | `{"status":"down","release":"<RELEASE_VERSION>"}` (and a warning log with the error tag) |
| the Worker cannot start its runtime (a missing binding, missing auth config) | 500 | the Worker's plain `Internal Server Error (request id: ...)`: `workers/app.ts` builds auth for every request before any route runs |

Either failure fails the [smoke check](#smoke-check). The route does not get its own lighter path through the Worker on purpose: a Worker whose auth cannot start is not up. The release is the `RELEASE_VERSION` var the deploy sets, or `unversioned`. The body never holds the error, the latency, the schema or anything about a user. Every answer carries `cache-control: no-store`. Any method but `GET` or `HEAD` gets an empty 405.

**Why no rate limit.** The route runs one `select 1`, and each isolate shares that answer for 5 seconds (`HEALTHZ_CHECK_TTL_MS`): requests that arrive while a check runs wait on the same one, even past the window, and a failed check counts as down for the window and is logged or reported once. So the route's own query runs at most once per isolate every 5 seconds whatever the request rate. Like every request, one that carries a session cookie also pays the session lookup in `workers/app.ts` before the route runs; that cost is the same as for any page and is not the route's. A Workers Rate Limiting binding keyed by IP would add a binding to every environment and could answer 429 to the deploy's own smoke check, which runs from GitHub's shared runner addresses. The Worker invocations themselves are what Cloudflare's own DDoS protection covers. The 5-second window means a database that just went down can read as up for up to 5 seconds on an isolate that checked it a moment before.

## Smoke check

`scripts/ci/smoke-check.ts` reads `/healthz` on a deployed origin:

```bash
bun scripts/ci/smoke-check.ts --url https://app.example.com [--release v3.1.0] [--worker <name> --version-id <uuid>]
```

- It passes on a 200 with `status: "up"`, and, when `--release` is given, that release. A redirect, a 5xx, a body of another shape or a timeout (10 seconds) is a failed attempt.
- It tries up to 6 times, 10 seconds apart, so a deployment still spreading across Cloudflare's network is not called broken. It exits 0 on a pass, 1 on a fail, 2 on bad arguments, and writes one line to the job summary.
- `--worker` and `--version-id` send `Cloudflare-Workers-Version-Overrides: <name>="<id>"`, which sends the request to that version while traffic is split between two. Cloudflare ignores the header when the version is not in the current deployment and serves the request by the split, so the check compares the release in the body as well: an answer from the old version fails it.
- The URL must be an `https` origin with no path (or `http` on localhost), and the Worker name and version id are checked, so no other header can be written through them.

## Staging

`staging` is a stage with its own Worker (`<name>-staging`), D1 database (`<name>-db-staging`), R2 bucket (`<name>-bucket-staging`) and rate-limit counters, declared under `env.staging` in `wrangler.jsonc`. Every merge into the `staging` branch goes there once CI passes, before anyone opens the release pull request into `production`.

`deploy-staging.yml`, in order:

1. Readiness (`deploy-gate.ts ready staging`): skips with a notice until `CLOUDFLARE_ACCOUNT_ID` is set, `env.staging` holds a real D1 id and `STAGING_URL` is set, and refuses while a repo-level `CLOUDFLARE_STAGING_API_TOKEN` exists (any branch's workflow can read a repo secret). Then the deploy job skips with a notice when the `staging` environment has no `CLOUDFLARE_STAGING_API_TOKEN`.
2. `wrangler d1 migrations apply DATABASE --env staging --remote`. There is no restore point here: staging data is test data. The [migration rule](rollback.md#the-rule-that-makes-rollback-possible) still holds, and staging is the first place a bad migration shows.
3. Build with `CLOUDFLARE_ENV=staging`, then `wrangler deploy` with `RELEASE_VERSION` set to the commit sha and `ENVIRONMENT` to `staging`.
4. The [smoke check](#smoke-check) on `STAGING_URL`, expecting that sha.
5. `playwright test --grep @deployed` with `E2E_BASE_URL=STAGING_URL`: the specs tagged `@deployed`, which only read and need no seeded account (`e2e/healthz.spec.ts`, the request-id spec). With `E2E_BASE_URL` set, Playwright starts no local server.

A failure fails the run (GitHub shows it on the commit and emails whoever is subscribed to failed runs), the job summary says which step broke, and the Playwright report is kept as an artifact for 7 days. Staging is not rolled back: the broken version stays on staging until the next merge fixes it, and the release pull request into `production` can wait for a green staging run.

To add a spec to the subset, tag it `@deployed` beside `@golden` or `@error`. A spec that signs in, writes data or needs local bindings must not carry it.

### Turn on staging

1. Run `bun run setup`. It creates the staging D1 database and R2 bucket beside production and preview, writes their names and the D1 id under `env.staging` in `wrangler.jsonc`, and applies the migrations to it. Commit `wrangler.jsonc`.
2. Deploy the staging Worker once by hand so it exists (`CLOUDFLARE_ENV=staging bun run build && bunx wrangler deploy`), then give it its auth secret and URL ([auth config](../auth.md)):

   ```bash
   bunx wrangler secret put BETTER_AUTH_SECRET --env staging
   ```

   and add `"vars": { "BETTER_AUTH_URL": "https://<name>-staging.<your-subdomain>.workers.dev" }` under `env.staging` in `wrangler.jsonc` (or your staging domain). Until both are set, every request, `/healthz` too, answers 500 and the smoke check fails.
3. Set the repo variable `STAGING_URL` to the same origin, with no path.
4. Apply the repo rules (`bun run scripts/repo-rules.ts --apply`): it protects the `staging` GitHub environment so only the default branch deploys from it ([repo rules](repo-rules.md#pending-items)).
5. Only after step 4: create a staging-only Cloudflare token (Workers edit and D1 edit; in a separate account for the strong setup, [Create the tokens](#create-the-tokens)) and add it as `CLOUDFLARE_STAGING_API_TOKEN` on the `staging` environment (Settings, Environments, staging). Never as a repo secret, and never before the environment is protected: until then any branch's workflow that names the environment can read it. The deploy job reads no other token, so it never holds the production one.

## Readiness and skips

Each of the four Cloudflare workflows starts with a `readiness` job that holds no secret value. It runs `scripts/ci/deploy-gate.ts`, which decides whether the repo is set up. When it is not, the later jobs are skipped and the notice says why (`::notice::<Workflow> skipped: <reason>`). The reasons live in that script. The two deploy jobs add one more skip: no `CLOUDFLARE_API_TOKEN` they can read.

The gate also warns (the run still passes) when a repo-level `CLOUDFLARE_API_TOKEN` secret exists: pull-request jobs can read repo-level secrets. Move it to the `production` environment and delete the repo-level one.

The `migrations` gate in `./scripts/verify.sh` checks new migrations; see [Rolling back](rollback.md#what-the-gate-checks).

A run that is set up but fails is a real failure. The usual cause is a token without D1 rights: the log says `Authentication error`, and the workflow adds a line naming the fix.

## Variables and secrets

| Name | Where it lives | Who reads it |
|------|----------------|--------------|
| `CLOUDFLARE_ACCOUNT_ID` | repo variable | deploy; also preview and cleanup when `CLOUDFLARE_PREVIEW_ACCOUNT_ID` is unset |
| `CLOUDFLARE_PREVIEW_ACCOUNT_ID` | repo variable, optional | preview and cleanup; use it for a separate preview account |
| `CLOUDFLARE_D1_DATABASE_ID` | repo variable, optional | deploy only; patched into the CI checkout's `wrangler.jsonc` |
| `PRODUCTION_URL` | repo variable, optional | deploy only; the production origin the rollout smoke-checks. Unset, the new version goes to 100% at once with no check ([automatic rollback](rollback.md#automatic-rollback)) |
| `D1_BACKUP_BUCKET` | repo variable, optional | deploy only; names a private R2 bucket for the pre-migration export ([rollback](rollback.md#owner-steps-to-turn-the-export-on)) |
| `CLOUDFLARE_API_TOKEN` | `production` environment secret | the production deploy job only |
| `CLOUDFLARE_STAGING_API_TOKEN` | `staging` environment secret, never a repo secret | the staging deploy job only; a repo-level one makes the staging gate refuse |
| `STAGING_URL` | repo variable | the staging deploy: smoke check and `@deployed` specs; an `https` origin with no path |
| `CLOUDFLARE_PREVIEW_API_TOKEN` | repo secret | the preview and cleanup jobs, on the single steps that call Cloudflare |
| `PREVIEW_SEED_SECRET` | repo secret (and your local `.env`) | the seed step of the preview job; `--print-password` on your machine |
| `PRODUCTION_SEED_SECRET` | not stored in GitHub; set in your shell | only when you run the forced production seed by hand |

The preview jobs never read `CLOUDFLARE_API_TOKEN`. The preview `readiness` job only tests whether it is set.

## Who can read what

- **Preview token and `PREVIEW_SEED_SECRET`:** anyone who can push a branch to this repo can read them, because a pull request can edit the workflow that uses them. That is why they are separate from the production token, and why a second Cloudflare account is the strong setup (below).
- **Production token:** a `production` environment secret is out of reach of pull-request code only once that environment is protected: a required reviewer, and deploys only from the default branch ([why](#why-the-environment-says-default-branch)). Until then, a branch in this repo can add `environment: production` to a workflow of its own and read the token. The owner applies the protection with `bun run scripts/repo-rules.ts --apply` (see [repo rules](repo-rules.md)). Protect the environment first, then add the token.

## Turn on production deploys

1. Run `bun run setup`. It creates the Cloudflare resources and writes their real ids into `wrangler.jsonc`. Commit that file. (This template keeps placeholder ids committed. If your repo does too, do step 6 instead.)
2. Set the repo variable `CLOUDFLARE_ACCOUNT_ID` (Settings, Secrets and variables, Actions, Variables).
3. Protect the `production` environment (see [Who can read what](#who-can-read-what)): a required reviewer, and deploys only from the default branch.
4. Create a Cloudflare API token ([Create the tokens](#create-the-tokens)).
5. Add it as the secret `CLOUDFLARE_API_TOKEN` in the `production` environment (Settings, Environments, production). `bun run setup` can do steps 2 and 5 when the GitHub CLI is available; it asks you to protect the environment first. It never replaces an environment that already exists.
6. Optional, for a repo that keeps placeholder ids committed: set the repo variable `CLOUDFLARE_D1_DATABASE_ID` to your production database id. The deploy job writes it into the checkout; the file in git does not change.
7. Delete any old repo-level `CLOUDFLARE_API_TOKEN` secret.
8. Optional: turn on the pre-migration export ([owner steps](rollback.md#owner-steps-to-turn-the-export-on)).
9. Set the repo variable `PRODUCTION_URL` to the production origin (an `https` origin, no path), so the rollout checks each step and can roll back. The Worker must already answer there: `BETTER_AUTH_URL` set ([auth config](../auth.md)).
10. Create `production` if you have not (`git push origin staging:production`), then merge a pull request from `staging` into `production` ([How a change reaches production](#how-a-change-reaches-production)). After CI passes on `production`, Deploy Production runs.

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
