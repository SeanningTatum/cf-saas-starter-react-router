export type Kind = "drop" | "rename" | "not-null-no-default" | "edited" | "deleted";

export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const GIT_OK = 0;

export const DRIZZLE_DIR = "drizzle";
export const SQL_SUFFIX = ".sql";
export const REASON_SUFFIX = ".reason.md";
export const MIN_REASON_CHARS = 30;
export const MAX_DETAIL_CHARS = 100;

export const DEFAULT_SCHEMA_PATH = "./app/db/schema.ts";
export const DRIZZLE_KIT_BIN = "node_modules/.bin/drizzle-kit";
export const DRIZZLE_DIALECT = "sqlite";
export const drizzleKitArgs = (schemaPath: string, outDir: string): string[] => [
  "generate",
  "--dialect",
  DRIZZLE_DIALECT,
  "--schema",
  schemaPath,
  "--out",
  outDir,
];
export const TEMP_PREFIX = "migration-check-";
export const NO_CHANGES_PATTERN = /No schema changes/i;
export const DRIZZLE_KIT_TIMEOUT_MS = 60000;

export const GIT_BIN = "git";
export const BASE_REF_ENV = "GITHUB_BASE_REF";
export const ORIGIN_PREFIX = "origin/";
export const SYMBOLIC_REF_ARGS: readonly string[] = [
  "symbolic-ref",
  "--quiet",
  "--short",
  "refs/remotes/origin/HEAD",
];
export const verifyRefArgs = (ref: string): string[] => [
  "rev-parse",
  "--verify",
  "--quiet",
  `${ref}^{commit}`,
];
export const mergeBaseArgs = (ref: string): string[] => ["merge-base", "HEAD", ref];
export const nameStatusArgs = (base: string): string[] => [
  "diff",
  "--name-status",
  "--no-renames",
  base,
  "--",
  DRIZZLE_DIR,
];

export const TOP_LEVEL_SQL_PATTERN = /^drizzle\/[^/]+\.sql$/;
export const STATUS_SEPARATOR = /\t/;
export const STATUS_MODIFIED = "M";
export const STATUS_DELETED = "D";

export const LINE_COMMENT = "--";
export const BLOCK_COMMENT_OPEN = "/*";
export const BLOCK_COMMENT_CLOSE = "*/";
export const NEWLINE = "\n";
export const STATEMENT_END = ";";
export const QUOTE_CLOSERS: Readonly<Record<string, string>> = {
  "'": "'",
  '"': '"',
  "`": "`",
  "[": "]",
};
export const WHITESPACE_RUN = /\s+/g;

export const DROP_STATEMENT = /^DROP\b/i;
export const ALTER_DROP = /^ALTER\s+TABLE\s+\S+\s+DROP\b/i;
export const ALTER_RENAME = /^ALTER\s+TABLE\s+\S+\s+RENAME\b/i;
export const ALTER_ADD = /^ALTER\s+TABLE\s+\S+\s+ADD\b/i;
export const NOT_NULL = /\bNOT\s+NULL\b/i;
export const HAS_DEFAULT = /\bDEFAULT\b/i;

export const FAIL_MARK = "✗";
export const PASS_MARK = "✓";
export const SKIP_NO_BASE_REF =
  "edited-migration check skipped: no base ref (no GITHUB_BASE_REF and no origin/HEAD commit)";
export const GIT_DIFF_FAILED = "could not list changed migrations with git diff";
export const DRIFT_UNCLEAR = "drizzle-kit gave no clear answer";
export const DRIFT_INDENT = "    ";
export const FIX_DRIFT = "  fix: run `bun run db:generate`, review the migration, commit it";

export const reasonPathFor = (sqlPath: string): string =>
  `${sqlPath.slice(0, sqlPath.length - SQL_SUFFIX.length)}${REASON_SUFFIX}`;

export const fixStatement = (reasonPath: string): string =>
  `  fix: write ${reasonPath} (${MIN_REASON_CHARS}+ characters) saying why the change is safe for the code that is live while it runs, or split it: add, backfill, switch reads and writes, drop in a later deploy (docs/ci/rollback.md)`;

export const fixApplied = (reasonPath: string): string =>
  `  fix: restore the file and put the change in a new migration, or write ${reasonPath} (${MIN_REASON_CHARS}+ characters) saying why it is safe`;

export const driftHeadline = (schemaPath: string): string =>
  `${FAIL_MARK} ${DRIZZLE_DIR}: drift: ${schemaPath} has changes no migration holds; drizzle-kit would write:`;

export const unclearHeadline = (): string =>
  `${FAIL_MARK} ${DRIZZLE_DIR}: drift: ${DRIFT_UNCLEAR}; its output:`;

export const appliedDetail = (ref: string): string =>
  `already on ${ref}; D1 records migrations by name, so an edited file never runs again`;

export const checkedSummary = (count: number): string =>
  `${PASS_MARK} migrations ok: ${count} checked, no drift`;
