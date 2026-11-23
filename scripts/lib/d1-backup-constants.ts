export const DATABASE_BINDING = "DATABASE";
export const WRANGLER_COMMAND: readonly string[] = ["bunx", "wrangler"];
export const GZIP_COMMAND = "gzip";
export const GZIP_FORCE_FLAG = "--force";
export const REMOTE_FLAG = "--remote";
export const JSON_FLAG = "--json";
export const OUTPUT_FLAG = "--output";
export const FILE_FLAG = "--file";

export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const SUCCESS_STATUS = 0;

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

const BACKUP_RETENTION_DAYS = 30;

export const BUCKET_NAME_RULE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
export const BOOKMARK_RULE = /^[0-9A-Za-z_-]+$/;
export const ISO_FRACTION = /\.\d+Z$/;
export const COLON = /:/g;
export const OPEN_BRACE = "{";
export const CLOSE_BRACE = "}";

const MS_PER_SECOND = 1000;
export const LIST_TIMEOUT_MS = 60_000;
export const INFO_TIMEOUT_MS = 60_000;
export const EXPORT_TIMEOUT_MS = 300_000;
export const GZIP_TIMEOUT_MS = 120_000;
export const UPLOAD_TIMEOUT_MS = 300_000;
export const TIMEOUT_CODE = "ETIMEDOUT";

export const BYTES_PER_MIB = 1_048_576;
export const MAX_UPLOAD_MIB = 300;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MIB * BYTES_PER_MIB;

const ROLLBACK_DOC = "docs/ci/rollback.md";

export const STEP_LIST = "list pending migrations";
export const STEP_EXPORT = "export the database";
export const STEP_COMPRESS = "compress the export";
export const STEP_UPLOAD = "upload the export to R2";

export const SUMMARY_HEADING = "### Restore point before the migration";
export const SUMMARY_SEE = `- See ${ROLLBACK_DOC}`;

export const LOG_NO_MIGRATION = "No migration to apply, so no restore point or export is needed.";
export const ERROR_NO_RESTORE_POINT = `::error::No restore point could be read from Time Travel, so the migration will not run. See ${ROLLBACK_DOC}`;
export const WARNING_NO_BUCKET = `::warning::No export was taken because the ${ENV_BUCKET} variable is not set. The Time Travel restore point above is the only way back. See ${ROLLBACK_DOC}`;
export const ERROR_BAD_BUCKET = `::error::${ENV_BUCKET} is not a valid R2 bucket name (3 to 63 characters: lower-case letters, digits and hyphens, starting and ending with a letter or digit), so the migration will not run.`;

export const stepFailed = (step: string, status: number): string =>
  `::error::Could not ${step} (exit ${status}), so the migration will not run. See ${ROLLBACK_DOC}`;
export const stepTimedOut = (step: string, timeoutMs: number): string =>
  `::error::Could not ${step}: it timed out after ${timeoutMs / MS_PER_SECOND} seconds, so the migration will not run. See ${ROLLBACK_DOC}`;
export const exportTooLarge = (sizeBytes: number): string =>
  `::error::The compressed export is ${Math.ceil(sizeBytes / BYTES_PER_MIB)} MiB, over the ${MAX_UPLOAD_MIB} MiB limit of an R2 upload, so the migration will not run. Unset the ${ENV_BUCKET} variable to deploy with the Time Travel restore point alone, or move the export to another route. See ${ROLLBACK_DOC}`;
export const bookmarkLine = (bookmark: string): string => `Time Travel restore point before the migration: ${bookmark}`;
export const uploadedLine = (key: string): string => `Exported the database to R2 as ${key}`;
export const summaryBookmark = (bookmark: string): string => `- Bookmark: \`${bookmark}\``;
export const summaryTime = (iso: string): string => `- Time (UTC): ${iso}`;
export const summaryCommit = (sha: string): string => `- Commit: \`${sha}\``;
export const summaryRestore = (command: string): string => `- Restore: \`${command}\``;
export const summaryExport = (key: string): string =>
  `Database export: \`${key}\`. The bucket's lifecycle rule sets how long it is kept (${ROLLBACK_DOC} asks for ${BACKUP_RETENTION_DAYS} days).`;
