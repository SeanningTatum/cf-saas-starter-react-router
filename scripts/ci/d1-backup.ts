#!/usr/bin/env bun
import { Either, Schema } from "effect";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BOOKMARK_RULE,
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
  EXIT_FAIL,
  EXIT_OK,
  EXPORT_FILE_NAME,
  EXPORT_TIMEOUT_MS,
  FILE_FLAG,
  GZIP_COMMAND,
  GZIP_FORCE_FLAG,
  GZIP_SUFFIX,
  GZIP_TIMEOUT_MS,
  HEX_ONLY,
  INFO_TIMEOUT_MS,
  ISO_FRACTION,
  JSON_FLAG,
  KEY_PREFIX,
  KEY_SUFFIX,
  LIST_TIMEOUT_MS,
  LOG_NO_MIGRATION,
  MAX_UPLOAD_BYTES,
  NO_MIGRATIONS_MARKER,
  OPEN_BRACE,
  OUTPUT_FLAG,
  REMOTE_FLAG,
  SHA_PREFIX_LENGTH,
  STEP_COMPRESS,
  STEP_EXPORT,
  STEP_LIST,
  STEP_UPLOAD,
  SUCCESS_STATUS,
  SUMMARY_HEADING,
  SUMMARY_SEE,
  TIMEOUT_CODE,
  UNKNOWN_SHA,
  UPLOAD_TIMEOUT_MS,
  WARNING_NO_BUCKET,
  WRANGLER_COMMAND,
  bookmarkLine,
  exportTooLarge,
  stepFailed,
  stepTimedOut,
  summaryBookmark,
  summaryCommit,
  summaryExport,
  summaryRestore,
  summaryTime,
  uploadedLine,
} from "../lib/d1-backup-constants";

export interface CommandResult {
  status: number;
  stdout: string;
  timedOut: boolean;
}

export interface Deps {
  env: Record<string, string | undefined>;
  runCommand: (argv: readonly string[], timeoutMs: number) => CommandResult;
  appendFile: (file: string, text: string) => void;
  removeFile: (file: string) => void;
  fileSize: (file: string) => number | undefined;
  log: (line: string) => void;
  now: () => Date;
  tempDir: string;
}

const Bookmark = Schema.parseJson(Schema.Struct({ bookmark: Schema.String.pipe(Schema.pattern(BOOKMARK_RULE)) }));
const decodeBookmark = Schema.decodeUnknownEither(Bookmark);

export function isMigrationPending(listOutput: string): boolean {
  return !listOutput.includes(NO_MIGRATIONS_MARKER);
}

export function parseBookmark(stdout: string): string | undefined {
  const first = stdout.indexOf(OPEN_BRACE);
  const last = stdout.lastIndexOf(CLOSE_BRACE);
  if (first < 0 || last < first) return undefined;
  const parsed = decodeBookmark(stdout.slice(first, last + 1));
  return Either.isRight(parsed) ? parsed.right.bookmark : undefined;
}

export function isValidBucketName(name: string): boolean {
  return BUCKET_NAME_RULE.test(name);
}

export function utcStamp(date: Date): string {
  return date.toISOString().replace(ISO_FRACTION, "Z").replace(COLON, "-");
}

function hexOrUnknown(sha: string | undefined): string {
  const trimmed = (sha ?? "").trim();
  return HEX_ONLY.test(trimmed) ? trimmed.toLowerCase() : UNKNOWN_SHA;
}

export function shortSha(sha: string | undefined): string {
  const hex = hexOrUnknown(sha);
  return hex === UNKNOWN_SHA ? hex : hex.slice(0, SHA_PREFIX_LENGTH);
}

export function objectKey(date: Date, sha: string | undefined): string {
  return `${KEY_PREFIX}/${utcStamp(date)}-${shortSha(sha)}${KEY_SUFFIX}`;
}

export const listArgv = (): string[] => [...WRANGLER_COMMAND, "d1", "migrations", "list", DATABASE_BINDING, REMOTE_FLAG];

export const timeTravelInfoArgv = (): string[] => [...WRANGLER_COMMAND, "d1", "time-travel", "info", DATABASE_BINDING, JSON_FLAG];

export const exportArgv = (file: string): string[] => [...WRANGLER_COMMAND, "d1", "export", DATABASE_BINDING, REMOTE_FLAG, OUTPUT_FLAG, file];

export const gzipArgv = (file: string): string[] => [GZIP_COMMAND, GZIP_FORCE_FLAG, file];

export const putArgv = (bucket: string, key: string, file: string): string[] => [
  ...WRANGLER_COMMAND,
  "r2",
  "object",
  "put",
  `${bucket}/${key}`,
  FILE_FLAG,
  file,
  REMOTE_FLAG,
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
    summaryBookmark(bookmark),
    summaryTime(deps.now().toISOString()),
    summaryCommit(hexOrUnknown(deps.env[ENV_SHA])),
    summaryRestore(restoreCommand(bookmark)),
    SUMMARY_SEE,
  ]);
}

function runStep(deps: Deps, step: string, argv: readonly string[], timeoutMs: number): CommandResult | undefined {
  const result = deps.runCommand(argv, timeoutMs);
  if (result.timedOut) {
    deps.log(stepTimedOut(step, timeoutMs));
    return undefined;
  }
  if (result.status !== SUCCESS_STATUS) {
    deps.log(stepFailed(step, result.status));
    return undefined;
  }
  return result;
}

function exportSteps(bucket: string, key: string, dump: string, packed: string, deps: Deps): number {
  if (!runStep(deps, STEP_EXPORT, exportArgv(dump), EXPORT_TIMEOUT_MS)) return EXIT_FAIL;
  if (!runStep(deps, STEP_COMPRESS, gzipArgv(dump), GZIP_TIMEOUT_MS)) return EXIT_FAIL;
  const size = deps.fileSize(packed);
  if (size !== undefined && size > MAX_UPLOAD_BYTES) {
    deps.log(exportTooLarge(size));
    return EXIT_FAIL;
  }
  const uploaded = runStep(deps, STEP_UPLOAD, putArgv(bucket, key, packed), UPLOAD_TIMEOUT_MS);
  return uploaded ? EXIT_OK : EXIT_FAIL;
}

function exportAndUpload(bucket: string, deps: Deps): number {
  const dir = (deps.env[ENV_RUNNER_TEMP] ?? "").trim() || deps.tempDir;
  const dump = path.join(dir, EXPORT_FILE_NAME);
  const packed = `${dump}${GZIP_SUFFIX}`;
  const key = objectKey(deps.now(), deps.env[ENV_SHA]);
  const clean = () => {
    deps.removeFile(dump);
    deps.removeFile(packed);
  };
  clean();
  const code = exportSteps(bucket, key, dump, packed, deps);
  clean();
  if (code === EXIT_OK) {
    deps.log(uploadedLine(key));
    appendSummary(deps, ["", summaryExport(key)]);
  }
  return code;
}

export function run(deps: Deps): number {
  const listed = runStep(deps, STEP_LIST, listArgv(), LIST_TIMEOUT_MS);
  if (!listed) return EXIT_FAIL;
  if (!isMigrationPending(listed.stdout)) {
    deps.log(LOG_NO_MIGRATION);
    return EXIT_OK;
  }
  return recordAndExport(deps);
}

function recordAndExport(deps: Deps): number {
  const info = deps.runCommand(timeTravelInfoArgv(), INFO_TIMEOUT_MS);
  const ok = !info.timedOut && info.status === SUCCESS_STATUS;
  const bookmark = ok ? parseBookmark(info.stdout) : undefined;
  if (bookmark === undefined) {
    deps.log(ERROR_NO_RESTORE_POINT);
    return EXIT_FAIL;
  }
  recordRestorePoint(bookmark, deps);

  const bucket = (deps.env[ENV_BUCKET] ?? "").trim();
  if (bucket === "") {
    deps.log(WARNING_NO_BUCKET);
    return EXIT_OK;
  }
  if (!isValidBucketName(bucket)) {
    deps.log(ERROR_BAD_BUCKET);
    return EXIT_FAIL;
  }
  return exportAndUpload(bucket, deps);
}

export function spawnCommand(argv: readonly string[], timeoutMs: number): CommandResult {
  const [file, ...args] = argv;
  if (file === undefined) return { status: EXIT_FAIL, stdout: "", timedOut: false };
  const result = spawnSync(file, args, {
    timeout: timeoutMs,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const error = result.error;
  const timedOut = error !== undefined && "code" in error && error.code === TIMEOUT_CODE;
  return {
    status: result.status ?? EXIT_FAIL,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    timedOut,
  };
}

function realDeps(): Deps {
  return {
    env: Bun.env,
    runCommand: spawnCommand,
    appendFile: (file, text) => fs.appendFileSync(file, text),
    removeFile: (file) => fs.rmSync(file, { force: true }),
    fileSize: (file) => fs.statSync(file, { throwIfNoEntry: false })?.size,
    log: (line) => console.log(line),
    now: () => new Date(),
    tempDir: os.tmpdir(),
  };
}

if (import.meta.main) {
  process.exit(run(realDeps()));
}
