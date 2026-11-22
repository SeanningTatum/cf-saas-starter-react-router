#!/usr/bin/env bun
import { Either, Schema } from "effect";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BACKUP_RETENTION_DAYS,
  BUCKET_NAME_RULE,
  CLOSE_BRACE,
  COLON,
  DATABASE_BINDING,
  ENV_BUCKET,
  ENV_RUNNER_TEMP,
  ENV_SHA,
  ENV_SUMMARY,
  ERROR_BAD_BUCKET,
  ERROR_NO_RESTORE_POINT,
  EXPORT_FILE_NAME,
  FILE_FLAG,
  GZIP_COMMAND,
  GZIP_FORCE_FLAG,
  GZIP_SUFFIX,
  HEX_ONLY,
  ISO_FRACTION,
  JSON_FLAG,
  KEY_PREFIX,
  KEY_SUFFIX,
  LOG_NO_MIGRATION,
  NO_MIGRATIONS_MARKER,
  OPEN_BRACE,
  OUTPUT_FLAG,
  REMOTE_FLAG,
  ROLLBACK_DOC,
  SHA_PREFIX_LENGTH,
  STEP_COMPRESS,
  STEP_EXPORT,
  STEP_UPLOAD,
  SUMMARY_HEADING,
  UNKNOWN_SHA,
  WARNING_NO_BUCKET,
  WRANGLER_COMMAND,
  bookmarkLine,
  listFailed,
  stepFailed,
  uploadedLine,
} from "../lib/d1-backup-constants";

export interface CommandResult {
  status: number;
  stdout: string;
}

export interface Deps {
  env: Record<string, string | undefined>;
  runCommand: (argv: readonly string[]) => CommandResult;
  appendFile: (file: string, text: string) => void;
  removeFile: (file: string) => void;
  log: (line: string) => void;
  now: () => Date;
  tempDir: string;
}

const Bookmark = Schema.parseJson(Schema.Struct({ bookmark: Schema.NonEmptyString }));
const decodeBookmark = Schema.decodeUnknownEither(Bookmark);

export function isMigrationPending(listOutput: string): boolean {
  return !listOutput.includes(NO_MIGRATIONS_MARKER);
}

export function parseBookmark(stdout: string): string | undefined {
  const starts = [...stdout.matchAll(OPEN_BRACE)].map((m) => m.index);
  const ends = [...stdout.matchAll(CLOSE_BRACE)].map((m) => m.index);
  for (const start of starts) {
    for (const end of ends) {
      if (end < start) continue;
      const parsed = decodeBookmark(stdout.slice(start, end + 1));
      if (Either.isRight(parsed)) return parsed.right.bookmark;
    }
  }
  return undefined;
}

export function isValidBucketName(name: string): boolean {
  return BUCKET_NAME_RULE.test(name);
}

export function utcStamp(date: Date): string {
  return date.toISOString().replace(ISO_FRACTION, "Z").replace(COLON, "-");
}

export function shortSha(sha: string | undefined): string {
  const trimmed = (sha ?? "").trim();
  return HEX_ONLY.test(trimmed) ? trimmed.slice(0, SHA_PREFIX_LENGTH).toLowerCase() : UNKNOWN_SHA;
}

export function objectKey(date: Date, sha: string | undefined): string {
  return `${KEY_PREFIX}/${utcStamp(date)}-${shortSha(sha)}${KEY_SUFFIX}`;
}

export const listArgv = (): string[] => [
  ...WRANGLER_COMMAND, "d1", "migrations", "list", DATABASE_BINDING, REMOTE_FLAG,
];

export const timeTravelInfoArgv = (): string[] => [
  ...WRANGLER_COMMAND, "d1", "time-travel", "info", DATABASE_BINDING, JSON_FLAG,
];

export const exportArgv = (file: string): string[] => [
  ...WRANGLER_COMMAND, "d1", "export", DATABASE_BINDING, REMOTE_FLAG, OUTPUT_FLAG, file,
];

export const gzipArgv = (file: string): string[] => [GZIP_COMMAND, GZIP_FORCE_FLAG, file];

export const putArgv = (bucket: string, key: string, file: string): string[] => [
  ...WRANGLER_COMMAND, "r2", "object", "put", `${bucket}/${key}`, FILE_FLAG, file, REMOTE_FLAG,
];

export const restoreCommand = (bookmark: string): string =>
  `${[...WRANGLER_COMMAND, "d1", "time-travel", "restore", DATABASE_BINDING].join(" ")} --bookmark=${bookmark}`;

function appendSummary(deps: Deps, lines: string[]): void {
  const file = deps.env[ENV_SUMMARY];
  if (file) deps.appendFile(file, `${lines.join("\n")}\n`);
}

function recordRestorePoint(bookmark: string, deps: Deps): void {
  deps.log(bookmarkLine(bookmark));
  appendSummary(deps, [
    SUMMARY_HEADING,
    "",
    `- Bookmark: \`${bookmark}\``,
    `- Time (UTC): ${deps.now().toISOString()}`,
    `- Commit: \`${(deps.env[ENV_SHA] ?? "").trim() || UNKNOWN_SHA}\``,
    `- Restore: \`${restoreCommand(bookmark)}\``,
    `- See ${ROLLBACK_DOC}`,
  ]);
}

function exportAndUpload(bucket: string, deps: Deps): number {
  const dir = (deps.env[ENV_RUNNER_TEMP] ?? "").trim() || deps.tempDir;
  const dump = path.join(dir, EXPORT_FILE_NAME);
  const packed = `${dump}${GZIP_SUFFIX}`;
  const key = objectKey(deps.now(), deps.env[ENV_SHA]);
  const steps: [string, string[]][] = [
    [STEP_EXPORT, exportArgv(dump)],
    [STEP_COMPRESS, gzipArgv(dump)],
    [STEP_UPLOAD, putArgv(bucket, key, packed)],
  ];
  let code = 0;
  for (const [step, argv] of steps) {
    const result = deps.runCommand(argv);
    if (result.status !== 0) {
      deps.log(stepFailed(step, result.status));
      code = 1;
      break;
    }
  }
  deps.removeFile(dump);
  deps.removeFile(packed);
  if (code === 0) {
    deps.log(uploadedLine(key));
    appendSummary(deps, [
      "",
      `Database export: \`${key}\`, kept for ${BACKUP_RETENTION_DAYS} days by the bucket's lifecycle rule.`,
    ]);
  }
  return code;
}

export function run(deps: Deps): number {
  const listed = deps.runCommand(listArgv());
  if (listed.status !== 0) {
    deps.log(listFailed(listed.status));
    return 1;
  }
  if (!isMigrationPending(listed.stdout)) {
    deps.log(LOG_NO_MIGRATION);
    return 0;
  }

  const info = deps.runCommand(timeTravelInfoArgv());
  const bookmark = info.status === 0 ? parseBookmark(info.stdout) : undefined;
  if (bookmark === undefined) {
    deps.log(ERROR_NO_RESTORE_POINT);
    return 1;
  }
  recordRestorePoint(bookmark, deps);

  const bucket = (deps.env[ENV_BUCKET] ?? "").trim();
  if (bucket === "") {
    deps.log(WARNING_NO_BUCKET);
    return 0;
  }
  if (!isValidBucketName(bucket)) {
    deps.log(ERROR_BAD_BUCKET);
    return 1;
  }
  return exportAndUpload(bucket, deps);
}

function realDeps(): Deps {
  return {
    env: Bun.env,
    runCommand: (argv) => {
      const result = Bun.spawnSync([...argv], { stdout: "pipe", stderr: "inherit" });
      return { status: result.exitCode ?? 1, stdout: result.stdout.toString() };
    },
    appendFile: (file, text) => fs.appendFileSync(file, text),
    removeFile: (file) => fs.rmSync(file, { force: true }),
    log: (line) => console.log(line),
    now: () => new Date(),
    tempDir: os.tmpdir(),
  };
}

if (import.meta.main) {
  process.exit(run(realDeps()));
}
