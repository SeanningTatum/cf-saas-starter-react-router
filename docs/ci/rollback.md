# Rolling back

Read this when a deploy went wrong. Start at the case that fits ([A](#case-a-the-new-code-is-bad-the-migration-is-fine), [B](#case-b-the-migration-ran-and-the-deploy-failed), [C](#case-c-restore-from-the-r2-export)). Every command runs from the repo root and needs a Cloudflare token in your shell (`bunx wrangler login`, or `CLOUDFLARE_API_TOKEN`).

`DATABASE` is the binding name in `wrangler.jsonc`; wrangler takes a binding or a database name.

## The rule that makes rollback possible

Four steps, each in its own deploy: add, backfill, switch reads and writes, drop later. Each migration must work with the code before it and the code after it.

Why: the deploy job migrates the database first, then deploys the Worker. For a while, old code runs on the new schema; if the Worker deploy fails, it keeps running there. And a Worker rollback never rolls the database back. If a migration breaks the code that is live, no rollback of the Worker fixes it.

Example, renaming `user.image` to `user.avatar_url`, in four deploys:

1. **Deploy 1, add.** The migration adds `avatar_url` (nullable, or with a default). The code writes both columns and still reads `image`.
2. **Deploy 2, backfill.** The migration copies the old values: `UPDATE user SET avatar_url = image WHERE avatar_url IS NULL`. It runs while deploy 1's code is live, so every new write already fills both columns and no row is missed. The code does not change. Before you go on, check that no row is left: `SELECT count(*) FROM user WHERE image IS NOT NULL AND avatar_url IS NULL` gives 0.
3. **Deploy 3, switch reads and writes.** The code reads `avatar_url` and no longer reads or writes `image`. No migration. `image` is nullable, so an insert that leaves it out still works. After this deploy no live code touches the old column. If you may need to roll this deploy back, split it in two: first read `avatar_url` while still writing both, then stop writing `image`; that way the older code always finds `image` current.
4. **Deploy 4, drop.** The migration drops `image`. It needs `drizzle/<name>.reason.md` (below). Because deploy 3 already runs, the code that is live while the drop happens does not write the column, and a failed Worker deploy leaves working code behind.

A `NOT NULL` column with no default needs one more step. `user.name` is one: if the code stopped writing it, every insert would fail until the column is gone. Before the deploy that stops the writes, ship a migration that makes the old column nullable or gives it a default, while the code still writes both. In SQLite that change is a table rebuild (Drizzle writes a `__new_user` table, copies the rows, drops the old table and renames the new one), so the gate flags it as a `DROP` and a `RENAME` and it needs its own reason file.

Three mistakes this order prevents. Switching reads without a backfill: rows written before deploy 1 have no `avatar_url`, read as blank, and lose their value when `image` is dropped. Dropping in the same deploy that stops the writes: the migration runs first, so the old code's writes to `image` fail until the new Worker is live, and keep failing if that deploy fails. Stopping the writes to a required column: inserts fail until the column is dropped.

Never rename or drop in one step. Never edit a migration that is already on the base branch: fix forward with a new one.

## What the gate checks

The `migrations` gate (`bun run scripts/migration-check.ts`, part of `./scripts/verify.sh`) fails on:

1. A `DROP`, a `RENAME`, or `ADD COLUMN ... NOT NULL` with no `DEFAULT` in a `drizzle/*.sql` file, unless `drizzle/<name>.reason.md` holds a written reason. One reason file covers every finding in that migration. The reason needs at least 30 characters that are not spaces.
2. A migration that is already on the base branch and was edited or deleted. The same reason file lifts it. The check is skipped, with a note, when there is no base ref to compare to (a shallow CI clone).
3. Drift: `app/db/schema.ts` and the migrations disagree. No reason file lifts this. Run `bun run db:generate`, read the new SQL, commit it.

The 30-character floor only proves a reason exists; a reviewer judges whether it is a good one. The gate guards against mistakes. It is not a security boundary: a pull request can change the script.

A good reason says two things: why the statement is safe for the code that is live while it runs, and how to get the data back. For example: "No code reads or writes `user.image` since deploy 3. Deploy 2 copied every value to `avatar_url` (0 rows left to copy). The deploy's restore point holds the old column."

## What the deploy saves before a migration

The step "Record a restore point before the migration" in `.github/workflows/deploy.yml` runs `bun scripts/ci/d1-backup.ts` right before the production migration. It acts only when a migration is pending (`wrangler d1 migrations list DATABASE --remote`).

1. **Time Travel bookmark.** It reads the current bookmark (`wrangler d1 time-travel info DATABASE --json`) and writes it, with the restore command, to the run's summary. If it cannot, the deploy stops before the migration.
2. **R2 export, when `D1_BACKUP_BUCKET` is set.** It exports the database (`wrangler d1 export DATABASE --remote --output <file>`), gzips it, uploads it to the bucket as `d1-exports/<UTC stamp>-<sha7>.sql.gz` and deletes the local file. If any of that fails, the deploy stops before the migration. With no bucket set, it prints a warning and goes on with the bookmark alone.

The two layers:

- **Time Travel** is always on and needs no setup. It restores to any minute in the last 30 days on Workers Paid, 7 days on Workers Free. See [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).
- **The R2 export** is a copy that does not depend on Time Travel. You can read it, or load it into another database. It is kept 30 days by a lifecycle rule you add once (below).

Why R2 and not a GitHub Actions artifact: this repo is public, so anyone who can see the runs can read an artifact. The dump holds user rows, password hashes and session tokens. It goes to a private R2 bucket in your own Cloudflare account, not the app's bucket.

The 30 days hold only after owner step 3 below. Until you add the rule, exports stay until you delete them.

Limits:

- An export blocks other requests to the database while it runs ([import and export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)). That is production downtime, and it grows with the size of the database. Time one export on your own database before you rely on it. The step stops an export after 5 minutes and fails the deploy; the migration does not run.
- The 300 MiB limit of `wrangler r2 object put` is on the gzipped file. The step checks the size before it uploads. Over the limit, the deploy fails with a message that names the size. Where the limit trips depends on how well the dump compresses. The way out: unset `D1_BACKUP_BUCKET` to deploy with the Time Travel restore point alone, or move the export to another route (the [Time Travel page](https://developers.cloudflare.com/d1/reference/time-travel/) points to an export to R2 through Workflows for long-term copies).
- An export does not support virtual tables (FTS5).
- The bookmark is read first, then the export runs, then the migration. Rows written in between are in a later bookmark (restore by `--timestamp`) but not in the export.
- On a self-hosted runner, a killed job can leave the dump in the runner's temp folder. The step deletes it on every path it controls, and again at its next start. GitHub-hosted runners (a fresh VM per job) are what this was built for.

## Owner steps to turn the export on

Run these once, by hand. The workflow never creates them.

1. Create a private bucket:

   ```bash
   bunx wrangler r2 bucket create <name>
   ```

2. Never enable public access on it: no `r2.dev` URL, no custom domain.
3. Add the 30-day rule ([object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)), and check it. Objects are usually removed within 24 hours of expiry.

   ```bash
   bunx wrangler r2 bucket lifecycle add <name> expire-d1-exports d1-exports/ --expire-days 30
   bunx wrangler r2 bucket lifecycle list <name>
   ```

4. Set the repo variable `D1_BACKUP_BUCKET` to `<name>` (Settings, Secrets and variables, Actions, Variables).
5. Give the production API token R2 write rights for this bucket only. The lifecycle docs name the permission group "Workers R2 Storage Write". When you create or edit the token, add that permission and limit it to the backup bucket if the token form lets you scope it to buckets; otherwise know that the token can write to every bucket in the account. `D1_BACKUP_BUCKET` must never name the app's own bucket (the one in `wrangler.jsonc`). If the upload fails with an authentication error, add the permission to the token.

## Automatic rollback

The production deploy does not move every user at once. After the migration and the build, `scripts/ci/rollout.ts`:

1. Reads the current deployment (`wrangler deployments status --json`) and keeps the version that serves 100% alone as the way back. If traffic is split (an earlier run that failed to roll back, or a split made by hand), it stops before the upload and asks you to send 100% to the good version first: a split has no safe way back.
2. Uploads the build as a new version (`wrangler versions upload`, with `RELEASE_VERSION` and `ENVIRONMENT=production`). Nothing serves it yet.
3. Moves traffic in steps, 10%, 50%, then 100% (`wrangler versions deploy <new>@10% <old>@90% --yes`). After each step it waits 60 seconds and runs the [smoke check](pipelines.md#smoke-check) on `PRODUCTION_URL`, pinned to the new version and expecting its release.
4. On a failed check, or a step wrangler refuses, it sends 100% back to the old version (`wrangler versions deploy <old>@100% --yes`), reads the deployment again to confirm the old version serves 100% alone, and the run fails. If that read shows anything else, it reports the rollback as failed.

A failure is announced on GitHub: the failed run, its job summary (outcome, versions, the step that failed), and a comment on the one open issue titled "Production deploy failed" (opened if there is none; only an issue the workflow itself opened counts, so an issue anyone else opens with that title is ignored). Close the issue once production is healthy; the next failure opens a new one.

What it does not do:

- **It never rolls the database back.** The migration ran before the upload, so the old version runs on the new schema. That is safe only because of [the rule above](#the-rule-that-makes-rollback-possible). For a migration that broke the old code, go to [Case B](#case-b-the-migration-ran-and-the-deploy-failed).
- **No `PRODUCTION_URL`, no checks.** Without the variable the new version goes to 100% at once, as before, with a warning. The same on a Worker's first deployment: there is no version to split with or go back to, so it goes to 100%, is checked, and a failed check fails the run without a rollback.
- **Only `/healthz`.** The check proves the Worker starts, its auth config builds and the database answers. A broken page or a broken procedure passes it. Watch the error reports for the first minutes after a release.
- **A split is per request.** During the 10% and 50% steps a user can get the old version on one request and the new one on the next. Code and data must work both ways for those minutes, which the migration rule already asks for.

Limits from Cloudflare ([gradual deployments](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/gradual-deployments/), [version overrides](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/version-overrides/)): a deployment serves at most two versions; a split can use only the last 100 uploaded versions; a version pin is ignored for a version outside the current deployment, and a deployment change takes a little time to reach every location, so the check compares the release and retries. A deploy that carries a Durable Object migration must use `wrangler deploy` instead (this app has none).

If the rollback itself fails, the job says so with the command to run by hand: `bunx wrangler versions deploy <old version id>@100% -y`.

## Case A: the new code is bad, the migration is fine

The Worker deploy failed, or the Worker runs and misbehaves. The database is fine.

```bash
bunx wrangler deployments list
bunx wrangler versions list
bunx wrangler rollback [version-id] --message "<why>"
```

With no version id, it goes back to the previous version. `-y` skips the prompt. `--name <worker>` picks the Worker. (`versions list` and `deployments list` show the 10 most recent.)

A rollback makes a new deployment that sends 100% of traffic to the chosen version. It does not change bound resources: D1, KV and R2 data stay as they are. Limits, from the [rollback docs](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/): only the 100 most recent versions; versions older than 30 days may be gone; refused across a Durable Object migration, or when the target binds a resource that no longer exists.

Then fix forward: revert the bad commit on the branch, so the next deploy does not ship the bad code again.

## Case B: the migration ran and the deploy failed

The database is ahead of the code.

If the migration followed the rule, the old code still works. Nothing to restore: fix the deploy and run it again. A migration that fails is rolled back by D1 itself: the failing migration is undone and the last good one stays applied.

If the old code breaks on the new schema, pick one:

1. **Fix forward.** Write a new migration and deploy. This keeps every row written since.
2. **Restore the database** to the bookmark in the run summary:

   ```bash
   bunx wrangler d1 time-travel restore DATABASE --bookmark=<bookmark>
   ```

   Or by time: `--timestamp=<unix seconds or RFC3339>`.

A restore overwrites the database in place, cancels in-flight queries, and loses every write made after that point. It prints a bookmark for the state before the restore; restoring to that one undoes it. The `d1_migrations` table goes back too, so the next deploy runs the migration again. Revert or fix the migration commit first.

## Case C: restore from the R2 export

Use this when the Time Travel window has passed, or you want the data somewhere else. Time Travel cannot clone a database to a new copy; the export can.

1. Download and unzip. Take the key from the bucket (the object is `d1-exports/<UTC stamp>-<sha7>.sql.gz`):

   ```bash
   bunx wrangler r2 object get <bucket>/d1-exports/<key> --file export.sql.gz --remote
   gunzip export.sql.gz
   ```

2. Per the [import page](https://developers.cloudflare.com/d1/best-practices/import-export-data/), remove the `BEGIN TRANSACTION` and `COMMIT;` lines from `export.sql` before you import. A statement over 100,000 bytes can fail.
3. Load it into a new database, not over the live one:

   ```bash
   bunx wrangler d1 create <name>-restore
   bunx wrangler d1 execute <name>-restore --remote --file=export.sql
   ```

4. Check the tables and row counts (`bunx wrangler d1 execute <name>-restore --remote --command "SELECT name FROM sqlite_master WHERE type = 'table'"`).
5. Point production at the new database id. If the repo variable `CLOUDFLARE_D1_DATABASE_ID` is set, change it to the new id (Settings, Secrets and variables, Actions, Variables): the deploy job writes that variable over the id in `wrangler.jsonc`, so editing the file alone would leave production on the old database. If the variable is not set, change the id of the `DATABASE` binding in `wrangler.jsonc` and commit it. Then deploy, and check the run's log names the new id.
6. Delete the downloaded file: `rm export.sql`. It holds user data.

## What was never run here

The export and restore commands were checked against the Cloudflare docs and `wrangler --help`, and the step's logic is unit-tested with a fake runner. No command was run against a real Cloudflare account while writing this page. Do one drill on a throwaway database before you need it.
