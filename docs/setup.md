# The set-up wizard

`bun run setup` takes a fork from a fresh clone to a deployable Worker and then walks the **production-readiness pass**: every setting a production deploy needs after the database and the bucket exist. Each setting is a **readiness item**. You can answer it at a prompt, pass it as a flag or an environment variable, or skip it. A skipped item is added later by running the same command with that one flag.

Nothing here creates a Cloudflare account, a token or a key for you. The wizard says where each one is made and takes it from there.

## Commands

| Command | What it does |
|---------|--------------|
| `bun run setup` | On a fresh clone: creates the D1 databases and R2 buckets, writes `wrangler.jsonc`, migrates, deploys, then runs the readiness pass. On a repo that is already set up: runs only the readiness pass, and asks only about items that are still unset. |
| `bun run setup --<item> <value>` | Sets that one item. Nothing else changes. |
| `bun run setup --check` | Prints a table: each item as `set`, `missing`, `skipped` or `unread`, and the command that sets it. Reads names only, never values. Exits 1 when a required item is not set. |
| `bun run setup --security` | Applies the security pass (below). Needs repo admin. |
| `bun run setup --provision` | Creates the resources again on a repo that already has them. Re-runs are safe: databases are found, buckets are kept, and the variables in `wrangler.jsonc` stay. |

Other options: `--yes` (ask nothing; an item with no answer is skipped), `--skip <item|group|environment|all>[,...]`, `--project-name <name>`, `--r2` / `--no-r2`, `--no-security`, `--rotate-auth-secret`.

## Unattended runs

The wizard asks nothing when every item has a value or a skip, or when `--yes` is set, or when standard input is not a terminal. An agent or a CI job can set up a fork like this:

```bash
SETUP_PRODUCTION_TOKEN="$TOKEN" bun run setup \
  --yes --project-name my-app --account-id <32 hex> \
  --auth-url https://app.example.com --skip preview,staging,turnstile,errors,analytics
```

## Items

Each item has a flag `--<id>` and a variable `SETUP_<ID>` (`--sentry-dsn`, `SETUP_SENTRY_DSN`). An id ends in `-preview` or `-staging` for that environment; with no suffix it is production.

| Id | What it is | Where it goes | Required |
|----|-----------|---------------|----------|
| `account-id` | Cloudflare account id | repo variable `CLOUDFLARE_ACCOUNT_ID` | yes |
| `production-token` | production deploy token | `production` environment secret `CLOUDFLARE_API_TOKEN` | yes |
| `preview-token` | token for pull-request previews | repo secret `CLOUDFLARE_PREVIEW_API_TOKEN`, plus a generated `PREVIEW_SEED_SECRET` | no |
| `staging-token` | token for the staging deploy | `staging` environment secret `CLOUDFLARE_STAGING_API_TOKEN` | no |
| `auth-secret` | signs sessions | `wrangler secret` `BETTER_AUTH_SECRET`; the wizard generates 64 characters | production |
| `auth-url` | the origin the app is served from | `vars` `BETTER_AUTH_URL` | production |
| `trusted-origins` | extra origins allowed to call the auth API | `vars` `AUTH_TRUSTED_ORIGINS` | no |
| `turnstile-site-key`, `turnstile-secret-key` | Turnstile bot check; both or neither | `vars` and `wrangler secret` | no |
| `sentry-dsn` | error reporter; also sets `ERROR_REPORTER=sentry` | `wrangler secret` `SENTRY_DSN` | no |
| `posthog-key`, `posthog-host` | analytics; the key also sets `ANALYTICS_PROVIDER=posthog` | `wrangler secret` and `vars` | no |

Each service stays off until its key is given. A fork that skips everything still builds, tests and deploys; the deploy gate skips what it cannot do ([readiness and skips](ci/pipelines.md#readiness-and-skips)).

Values are checked before anything is written, with the same code the Worker uses at start-up (`resolveAuthConfig`): a short auth secret, a plain `http` URL, a wildcard origin on a shared suffix, a published Turnstile test key, or half a Turnstile pair is refused, because a Worker with one of them answers every request with a 500. The wizard also refuses to set one Turnstile key unless the other is set or comes in the same run.

An auth secret is never replaced while one exists: a new one signs every user out. `--rotate-auth-secret` replaces it on purpose. Production and preview get a generated secret; staging only gets one you pass.

## How secrets travel

- A secret goes to `wrangler secret put` or `gh secret set` on standard input. It is never in argv, in a shell line, in the environment of the child, in a tracked file or in output. A failed command's text has the value removed before it prints.
- The wizard reads a secret from a hidden prompt, from `SETUP_<ID>`, or from standard input with `--<id>=-` (one item per run). `--<id> <secret>` is refused, because argv shows in the process list.
- `--check` runs `wrangler secret list` and `gh secret list --json name`. They return names only.
- Variables (`BETTER_AUTH_URL` and the like) are public and go into `wrangler.jsonc`. Commit that file and redeploy to apply them; secrets apply at once.
- The unit tests prove each of these for every secret item (`scripts/lib/__tests__/setup-stores.test.ts`, `setup-readiness-run.test.ts`).

## The security pass

`--security` (or a yes at the prompt) applies what a script can and lists the rest as `left`:

| Step | How |
|------|-----|
| Repo rules and the `production` environment's required reviewer | `bun run scripts/repo-rules.ts --apply` ([repo rules](ci/repo-rules.md)) |
| Dependency alerts | `PUT repos/{owner}/{repo}/vulnerability-alerts` |
| Secret scanning and push protection | `PATCH repos/{owner}/{repo}` |
| Private vulnerability reports | `PUT repos/{owner}/{repo}/private-vulnerability-reporting` |
| Auth secret length | checked when the secret is set (at least 32 characters, not a published value); a stored secret cannot be read back, so an older one is `left`, and `--rotate-auth-secret` replaces it |

Each step reads first and writes only when the setting is off, so a second run makes no write. Every step needs repo admin; a refusal prints the reason and the page to use. The pass runs before a deploy token is set, so a branch cannot read the token before the environment is protected.

## Token scopes

Create each token at https://dash.cloudflare.com/profile/api-tokens, scoped to one account.

| Token | Permissions it needs | Nothing more |
|-------|----------------------|--------------|
| Production deploy (`production-token`) | start from "Edit Cloudflare Workers"; add Account, D1, Edit | no zone, user or all-accounts scope |
| Preview (`preview-token`) | the same two permissions | put it in a second account if you can ([why](ci/pipelines.md#create-the-tokens)) |
| Staging (`staging-token`) | the same two permissions | scope to the account that holds the staging Worker |
| Pre-migration export (optional, [rollback](ci/rollback.md)) | add Account, Workers R2 Storage, Edit | only when you turn the export on |

The wizard itself uses your `wrangler login` session, not a token, to create the databases and buckets.

## Human steps

The wizard cannot do these for you: create the Cloudflare account and the tokens, create the Turnstile widget, the Sentry project and the PostHog project, and run the security pass with a login that has repo admin. `bun run setup --check` lists what is left.
