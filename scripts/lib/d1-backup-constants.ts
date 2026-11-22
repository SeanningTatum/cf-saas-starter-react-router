export const DATABASE_BINDING = "DATABASE";
export const WRANGLER_COMMAND: readonly string[] = ["bunx", "wrangler"];
export const GZIP_COMMAND = "gzip";
export const GZIP_FORCE_FLAG = "--force";
export const REMOTE_FLAG = "--remote";
export const JSON_FLAG = "--json";
export const OUTPUT_FLAG = "--output";
export const FILE_FLAG = "--file";

export const NO_MIGRATIONS_MARKER = "No migrations to apply";

export const ENV_BUCKET = "D1_BACKUP_BUCKET";
export const ENV_SHA = "DEPLOY_SHA";
export const ENV_SUMMARY = "GITHUB_STEP_SUMMARY";
export const ENV_RUNNER_TEMP = "RUNNER_TEMP";

export const EXPORT_FILE_NAME = "d1-export.sql";
export const GZIP_SUFFIX = ".gz";
export const KEY_PREFIX = "d1-exports";
export const KEY_SUFFIX = ".sql.gz";
export const UNKNOWN_SHA = "unknown";
export const SHA_PREFIX_LENGTH = 7;
export const HEX_ONLY = /^[0-9a-f]+$/i;

export const BACKUP_RETENTION_DAYS = 30;

export const BUCKET_NAME_RULE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
export const ISO_FRACTION = /\.\d+Z$/;
export const COLON = /:/g;
export const OPEN_BRACE = /\{/g;
export const CLOSE_BRACE = /\}/g;

export const ROLLBACK_DOC = "docs/ci/rollback.md";

export const STEP_LIST = "list pending migrations";
export const STEP_EXPORT = "export the database";
export const STEP_COMPRESS = "compress the export";
export const STEP_UPLOAD = "upload the export to R2";

export const SUMMARY_HEADING = "### Restore point before the migration";

export const LOG_NO_MIGRATION =
  "No migration to apply, so no restore point or export is needed.";
export const ERROR_NO_RESTORE_POINT = `::error::No restore point could be read from Time Travel, so the migration will not run. See ${ROLLBACK_DOC}`;
export const WARNING_NO_BUCKET = `::warning::No export was taken because the ${ENV_BUCKET} variable is not set. The Time Travel restore point above is the only way back. See ${ROLLBACK_DOC}`;
export const ERROR_BAD_BUCKET = `::error::${ENV_BUCKET} is not a valid R2 bucket name (3 to 63 characters: lower-case letters, digits and hyphens, starting and ending with a letter or digit), so the migration will not run.`;

export const listFailed = (status: number): string =>
  `::error::Could not ${STEP_LIST} (exit ${status}), so the migration will not run.`;
export const stepFailed = (step: string, status: number): string =>
  `::error::Could not ${step} (exit ${status}), so the migration will not run. See ${ROLLBACK_DOC}`;
export const bookmarkLine = (bookmark: string): string =>
  `Time Travel restore point before the migration: ${bookmark}`;
export const uploadedLine = (key: string): string => `Exported the database to R2 as ${key}`;
