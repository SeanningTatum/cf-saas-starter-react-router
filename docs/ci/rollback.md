# Rolling back

Read this when a deploy went wrong. Start at the case that fits ([A](#case-a-the-new-code-is-bad-the-migration-is-fine), [B](#case-b-the-migration-ran-and-the-deploy-failed), [C](#case-c-restore-from-the-r2-export)). Every command runs from the repo root and needs a Cloudflare token in your shell (`bunx wrangler login`, or `CLOUDFLARE_API_TOKEN`).

`DATABASE` is the binding name in `wrangler.jsonc`; wrangler takes a binding or a database name.

## The rule that makes rollback possible

Add first, switch the code, remove in a later deploy (expand, switch, contract). Each migration must work with the code before it and the code after it.

Why: the deploy job migrates the database first, then deploys the Worker. For a while, old code runs on the new schema. And a Worker rollback never rolls the database back. If a migration breaks the code that is live, no rollback of the Worker fixes it.

Example, renaming `user.name` to `user.display_name`, in three deploys:

1. **Deploy 1, expand.** The migration adds `display_name` (nullable, or with a default). The code writes both columns and still reads `name`.
2. **Deploy 2, switch.** The code reads `display_name`. It still writes both, so a rollback to deploy 1 finds `name` current.
3. **Deploy 3, contract.** The migration drops `name`. It needs `drizzle/<name>.reason.md` (below). No live code reads `name` any more.

Never rename or drop in one step. Never edit a migration that is already on the base branch: fix forward with a new one.

## What the gate checks

The `migrations` gate (`bun run scripts/migration-check.ts`, part of `./scripts/verify.sh`) fails on:

1. A `DROP`, a `RENAME`, or `ADD COLUMN ... NOT NULL` with no `DEFAULT` in a `drizzle/*.sql` file, unless `drizzle/<name>.reason.md` holds a written reason. One reason file covers every finding in that migration. The reason needs at least 30 characters that are not spaces.
2. A migration that is already on the base branch and was edited or deleted. The same reason file lifts it. The check is skipped, with a note, when there is no base ref to compare to (a shallow CI clone).
3. Drift: `app/db/schema.ts` and the migrations disagree. No reason file lifts this. Run `bun run db:generate`, read the new SQL, commit it.

A good reason says two things: why the statement is safe for the code that is live while it runs, and how to get the data back. For example: "No code reads `user.name` since deploy 2. The column's values are copied in `display_name`; the deploy's restore point holds the old column."

## What the deploy saves before a migration

The step "Record a restore point before the migration" in `.github/workflows/deploy.yml` runs `bun scripts/ci/d1-backup.ts` right before the production migration. It acts only when a migration is pending (`wrangler d1 migrations list DATABASE --remote`).

1. **Time Travel bookmark.** It reads the current bookmark (`wrangler d1 time-travel info DATABASE --json`) and writes it, with the restore command, to the run's summary. If it cannot, the deploy stops before the migration.
2. **R2 export, when `D1_BACKUP_BUCKET` is set.** It exports the database (`wrangler d1 export DATABASE --remote --output <file>`), gzips it, uploads it to the bucket as `d1-exports/<UTC stamp>-<sha7>.sql.gz` and deletes the local file. If any of that fails, the deploy stops before the migration. With no bucket set, it prints a warning and goes on with the bookmark alone.

The two layers:

- **Time Travel** is always on and needs no setup. It restores to any minute in the last 30 days on Workers Paid, 7 days on Workers Free. See [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).
- **The R2 export** is a copy that does not depend on Time Travel. You can read it, or load it into another database. It is kept 30 days by a lifecycle rule you add once (below).

Why R2 and not a GitHub Actions artifact: this repo is public, so anyone who can see the runs can read an artifact. The dump holds user rows, password hashes and session tokens. It goes to a private R2 bucket in your own Cloudflare account, not the app's bucket.

Limits:

- An export blocks other requests to the database while it runs ([import and export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)).
- An export does not support virtual tables (FTS5).
- `wrangler r2 object put` takes files up to 300 MiB. A larger database needs another route; the step does not have one, and it will fail the deploy.
- Rows written between the export and the migration are in the bookmark but not in the export.

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
5. Give the production API token R2 write rights. The lifecycle docs name the permission group "Workers R2 Storage Write". If the upload fails with an authentication error, add it to the token.

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
5. Point the `DATABASE` binding in `wrangler.jsonc` at the new database id, then deploy.
6. Delete the downloaded file: `rm export.sql`. It holds user data.

## What was never run here

The export and restore commands were checked against the Cloudflare docs and `wrangler --help`, and the step's logic is unit-tested with a fake runner. No command was run against a real Cloudflare account while writing this page. Do one drill on a throwaway database before you need it.
