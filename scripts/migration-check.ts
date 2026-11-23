#!/usr/bin/env bun
import { Effect } from "effect";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALTER_ADD,
  ALTER_DROP,
  ALTER_RENAME,
  BASE_REF_ENV,
  BLOCK_COMMENT_CLOSE,
  BLOCK_COMMENT_OPEN,
  DEFAULT_SCHEMA_PATH,
  DRIFT_INDENT,
  DRIZZLE_DIR,
  DRIZZLE_KIT_BIN,
  DRIZZLE_KIT_TIMEOUT_MS,
  DROP_STATEMENT,
  EXIT_FAIL,
  EXIT_OK,
  FAIL_MARK,
  FIX_DRIFT,
  GIT_BIN,
  GIT_DIFF_FAILED,
  GIT_OK,
  HAS_DEFAULT,
  LINE_COMMENT,
  MAX_DETAIL_CHARS,
  MIN_REASON_CHARS,
  NEWLINE,
  NOT_NULL,
  NO_CHANGES_PATTERN,
  ORIGIN_PREFIX,
  PASS_MARK,
  QUOTE_CLOSERS,
  SKIP_NO_BASE_REF,
  SQL_SUFFIX,
  STATEMENT_END,
  STATUS_DELETED,
  STATUS_MODIFIED,
  STATUS_SEPARATOR,
  SYMBOLIC_REF_ARGS,
  TEMP_PREFIX,
  TOP_LEVEL_SQL_PATTERN,
  WHITESPACE_RUN,
  appliedDetail,
  checkedSummary,
  driftHeadline,
  drizzleKitArgs,
  fixApplied,
  fixStatement,
  mergeBaseArgs,
  nameStatusArgs,
  reasonPathFor,
  unclearHeadline,
  verifyRefArgs,
  type Kind,
} from "./lib/migration-constants";

export interface Statement {
  match: string;
  show: string;
}

export interface Finding {
  file: string;
  kind: Kind;
  detail: string;
}

export type ReasonState = "ok" | "missing" | "short";

export interface GitResult {
  status: number;
  stdout: string;
}

export interface NewMigration {
  name: string;
  sql: string;
}

export interface DriftProbe {
  newFiles: NewMigration[];
  output: string;
}

export type DriftVerdict = { kind: "clean" } | { kind: "drift"; files: NewMigration[] } | { kind: "unclear"; output: string };

export interface Deps {
  env: Record<string, string | undefined>;
  schemaPath: string;
  listSql: () => string[];
  readFile: (file: string) => string | undefined;
  git: (argv: string[]) => GitResult;
  drift: (schemaPath: string) => DriftProbe;
  log: (line: string) => void;
}

const squash = (text: string): string => text.replace(WHITESPACE_RUN, " ").trim();

export function splitStatements(sql: string): Statement[] {
  const out: Statement[] = [];
  let match = "";
  let show = "";
  const flush = () => {
    const statement = { match: squash(match), show: squash(show) };
    if (statement.match) out.push(statement);
    match = "";
    show = "";
  };
  let i = 0;
  while (i < sql.length) {
    const ch = sql.charAt(i);
    if (sql.startsWith(LINE_COMMENT, i)) {
      const end = sql.indexOf(NEWLINE, i);
      i = end < 0 ? sql.length : end;
      match += " ";
      show += " ";
      continue;
    }
    if (sql.startsWith(BLOCK_COMMENT_OPEN, i)) {
      const end = sql.indexOf(BLOCK_COMMENT_CLOSE, i + BLOCK_COMMENT_OPEN.length);
      i = end < 0 ? sql.length : end + BLOCK_COMMENT_CLOSE.length;
      match += " ";
      show += " ";
      continue;
    }
    const closer = QUOTE_CLOSERS[ch];
    if (closer !== undefined) {
      const end = sql.indexOf(closer, i + 1);
      const last = end < 0 ? sql.length : end + 1;
      match += `${ch}${closer}`;
      show += sql.slice(i, last);
      i = last;
      continue;
    }
    if (ch === STATEMENT_END) {
      flush();
    } else {
      match += ch;
      show += ch;
    }
    i += 1;
  }
  flush();
  return out;
}

export function classifyStatement(match: string): Kind | undefined {
  if (DROP_STATEMENT.test(match) || ALTER_DROP.test(match)) return "drop";
  if (ALTER_RENAME.test(match)) return "rename";
  if (ALTER_ADD.test(match) && NOT_NULL.test(match) && !HAS_DEFAULT.test(match)) {
    return "not-null-no-default";
  }
  return undefined;
}

export function scanSql(file: string, sql: string): Finding[] {
  const found: Finding[] = [];
  for (const statement of splitStatements(sql)) {
    const kind = classifyStatement(statement.match);
    if (kind) found.push({ file, kind, detail: statement.show.slice(0, MAX_DETAIL_CHARS) });
  }
  return found;
}

export function reasonState(text: string | undefined): ReasonState {
  if (text === undefined) return "missing";
  const chars = text.replace(WHITESPACE_RUN, "").length;
  return chars >= MIN_REASON_CHARS ? "ok" : "short";
}

export function parseNameStatus(text: string): Finding[] {
  const out: Finding[] = [];
  for (const line of text.split(NEWLINE)) {
    const [status, file] = line.split(STATUS_SEPARATOR);
    if (file === undefined || !TOP_LEVEL_SQL_PATTERN.test(file)) continue;
    if (status === STATUS_MODIFIED) out.push({ file, kind: "edited", detail: "" });
    if (status === STATUS_DELETED) out.push({ file, kind: "deleted", detail: "" });
  }
  return out;
}

export function resolveBaseRef(deps: Pick<Deps, "env" | "git">): string | undefined {
  const candidates: string[] = [];
  const fromEnv = (deps.env[BASE_REF_ENV] ?? "").trim();
  if (fromEnv) candidates.push(`${ORIGIN_PREFIX}${fromEnv}`);
  const head = deps.git([...SYMBOLIC_REF_ARGS]);
  const headRef = head.stdout.trim();
  if (head.status === GIT_OK && headRef) candidates.push(headRef);
  return candidates.find((ref) => deps.git(verifyRefArgs(ref)).status === GIT_OK);
}

export function decideDrift(probe: DriftProbe): DriftVerdict {
  if (probe.newFiles.length > 0) return { kind: "drift", files: probe.newFiles };
  if (NO_CHANGES_PATTERN.test(probe.output)) return { kind: "clean" };
  return { kind: "unclear", output: probe.output };
}

function generateIn(repoRoot: string, schemaPath: string, tempDir: string): DriftProbe {
  fs.cpSync(path.join(repoRoot, DRIZZLE_DIR), tempDir, { recursive: true });
  const before = new Set(fs.readdirSync(tempDir));
  const result = spawnSync(path.join(repoRoot, DRIZZLE_KIT_BIN), drizzleKitArgs(schemaPath, path.relative(repoRoot, tempDir)), {
    cwd: repoRoot,
    input: "",
    encoding: "utf-8",
    timeout: DRIZZLE_KIT_TIMEOUT_MS,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`;
  const newFiles = fs
    .readdirSync(tempDir)
    .filter((name) => name.endsWith(SQL_SUFFIX) && !before.has(name))
    .sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(tempDir, name), "utf-8") }));
  return { newFiles, output };
}

const failedProbe = (error: unknown): DriftProbe => ({
  newFiles: [],
  output: error instanceof Error ? error.message : String(error),
});

export function generateInTempCopy(repoRoot: string, schemaPath: string, tempRoot: string = os.tmpdir()): DriftProbe {
  return Effect.runSync(
    Effect.acquireUseRelease(
      Effect.try(() => fs.mkdtempSync(path.join(tempRoot, TEMP_PREFIX))),
      (tempDir) => Effect.try(() => generateIn(repoRoot, schemaPath, tempDir)),
      (tempDir) => Effect.sync(() => fs.rmSync(tempDir, { recursive: true, force: true })),
    ).pipe(Effect.catchAll((error) => Effect.succeed(failedProbe(error.cause)))),
  );
}

interface Outcome {
  lines: string[];
  failures: number;
}

const emptyOutcome = (): Outcome => ({ lines: [], failures: 0 });

function reportFinding(finding: Finding, deps: Deps, outcome: Outcome, applied: boolean): void {
  const reasonPath = reasonPathFor(finding.file);
  const label = `${finding.file}: ${finding.kind}: ${finding.detail}`;
  if (reasonState(deps.readFile(reasonPath)) === "ok") {
    outcome.lines.push(`${PASS_MARK} ${label} (reason: ${reasonPath})`);
    return;
  }
  outcome.failures += 1;
  outcome.lines.push(`${FAIL_MARK} ${label}`);
  outcome.lines.push(applied ? fixApplied(reasonPath) : fixStatement(reasonPath));
}

function checkStatements(deps: Deps, names: string[]): Outcome {
  const outcome = emptyOutcome();
  for (const name of names) {
    const file = path.posix.join(DRIZZLE_DIR, name);
    const sql = deps.readFile(file);
    if (sql === undefined) continue;
    for (const finding of scanSql(file, sql)) reportFinding(finding, deps, outcome, false);
  }
  return outcome;
}

function checkApplied(deps: Deps): Outcome {
  const outcome = emptyOutcome();
  const ref = resolveBaseRef(deps);
  if (ref === undefined) {
    outcome.lines.push(SKIP_NO_BASE_REF);
    return outcome;
  }
  const mergeBase = deps.git(mergeBaseArgs(ref));
  const base = mergeBase.status === GIT_OK && mergeBase.stdout.trim() ? mergeBase.stdout.trim() : ref;
  const diff = deps.git(nameStatusArgs(base));
  if (diff.status !== GIT_OK) {
    outcome.failures += 1;
    outcome.lines.push(`${FAIL_MARK} ${DRIZZLE_DIR}: ${GIT_DIFF_FAILED}`);
    return outcome;
  }
  for (const finding of parseNameStatus(diff.stdout)) {
    reportFinding({ ...finding, detail: appliedDetail(ref) }, deps, outcome, true);
  }
  return outcome;
}

function checkDrift(deps: Deps): Outcome {
  const outcome = emptyOutcome();
  const verdict = decideDrift(deps.drift(deps.schemaPath));
  if (verdict.kind === "clean") return outcome;
  outcome.failures += 1;
  if (verdict.kind === "drift") {
    outcome.lines.push(driftHeadline(deps.schemaPath));
    for (const file of verdict.files) {
      for (const line of file.sql.split(NEWLINE)) outcome.lines.push(`${DRIFT_INDENT}${line}`);
    }
    outcome.lines.push(FIX_DRIFT);
    return outcome;
  }
  outcome.lines.push(unclearHeadline());
  for (const line of verdict.output.split(NEWLINE)) outcome.lines.push(`${DRIFT_INDENT}${line}`);
  return outcome;
}

export function run(deps: Deps): number {
  const names = deps.listSql();
  const outcomes = [checkStatements(deps, names), checkApplied(deps), checkDrift(deps)];
  for (const outcome of outcomes) for (const line of outcome.lines) deps.log(line);
  const failures = outcomes.reduce((sum, outcome) => sum + outcome.failures, 0);
  if (failures > 0) return EXIT_FAIL;
  deps.log(checkedSummary(names.length));
  return EXIT_OK;
}

function realDeps(repoRoot: string): Deps {
  return {
    env: Bun.env,
    schemaPath: DEFAULT_SCHEMA_PATH,
    listSql: () =>
      fs
        .readdirSync(path.join(repoRoot, DRIZZLE_DIR), { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(SQL_SUFFIX))
        .map((entry) => entry.name)
        .sort(),
    readFile: (file) => {
      const full = path.join(repoRoot, file);
      return fs.existsSync(full) ? fs.readFileSync(full, "utf-8") : undefined;
    },
    git: (argv) => {
      const result = spawnSync(GIT_BIN, argv, { cwd: repoRoot, encoding: "utf-8" });
      return { status: result.status ?? EXIT_FAIL, stdout: result.stdout ?? "" };
    },
    drift: (schemaPath) => generateInTempCopy(repoRoot, schemaPath),
    log: (line) => console.log(line),
  };
}

if (import.meta.main) {
  const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  process.exit(run(realDeps(repoRoot)));
}
