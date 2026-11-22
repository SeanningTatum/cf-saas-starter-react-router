# CI and deploy pipelines

Seven workflows live in `.github/workflows/`. Deploy and preview stay off until you set up your Cloudflare account. A repo that is not set up ends those runs as skipped with a one-line notice, and the run stays green.

## What each workflow does

| Workflow | Runs on | What it does |
|----------|---------|--------------|
| `ci.yml` | every push to `staging` or `production`, every pull request | typecheck, tests, build, e2e smoke |
| `codeql.yml` (CodeQL) | every push to `staging` or `production`, every pull request, and Mondays | reads the source for injection and workflow mistakes |
| `production-guard.yml` (Production Guard) | a pull request into `production` | fails unless the pull request comes from this repo's `staging` |
| `release.yml` (Release) | every push to `production` | picks the next version, tags the commit, creates the GitHub release |
| `deploy.yml` (Deploy Production) | CI finished green on a push to `production` | migrates the production D1 database (first saving a [restore point](rollback.md)), builds, runs `wrangler deploy` with the release version (the tag, or the commit sha) and `ENVIRONMENT:production` |
| `preview.yml` (Preview Deploy) | a pull request opened, updated or reopened | gives the PR its own D1 database, seeds it, uploads a Worker version with the PR's head sha as its release version and `ENVIRONMENT:preview`, comments the URL |
| `preview-cleanup.yml` (Preview Cleanup) | a pull request closed | deletes the PR's D1 database |

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
5. After CI passes on `production`, `deploy.yml` deploys that commit.

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

If your default branch has another name, the simplest way is to rename it to `staging`. To keep your name instead, change it in three places: the `branches:` lines under `push:` in `ci.yml` and in `codeql.yml`, and the source check in `production-guard.yml` (`"$HEAD_REF" != "staging"`). The workflow tests read the two names from `ci.yml` and hold the other workflows to them, so a missed place fails `bun run test`.

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

## Readiness and skips

Each of the three Cloudflare workflows starts with a `readiness` job that holds no secret value. It runs `scripts/ci/deploy-gate.ts`, which decides whether the repo is set up. When it is not, the later jobs are skipped and the notice says why (`::notice::<Workflow> skipped: <reason>`). The reasons live in that script. The deploy job adds one more skip: no `CLOUDFLARE_API_TOKEN` in the `production` environment.

The gate also warns (the run still passes) when a repo-level `CLOUDFLARE_API_TOKEN` secret exists: pull-request jobs can read repo-level secrets. Move it to the `production` environment and delete the repo-level one.

The `migrations` gate in `./scripts/verify.sh` checks new migrations; see [Rolling back](rollback.md#what-the-gate-checks).

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
9. Create `production` if you have not (`git push origin staging:production`), then merge a pull request from `staging` into `production` ([How a change reaches production](#how-a-change-reaches-production)). After CI passes on `production`, Deploy Production runs.

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
