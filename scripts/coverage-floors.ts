#!/usr/bin/env bun
import { Either, Schema } from "effect";
import { join } from "node:path";
import {
  BUNX_BIN,
  COVERAGE_DOC,
  COVERAGE_FLOORS,
  COVERAGE_SUMMARY_FILE,
  COVERAGE_TEMP_PREFIX,
  COVERAGE_TEST_ROOTS,
  COVERAGE_WORST_FILES,
  FULL_PERCENT,
  PERCENT_DECIMALS,
} from "./lib/coverage-constants";
import { realShell, tail, type RunResult, type Shell } from "./lib/shell";
import { EXIT_FAIL, EXIT_OK } from "./lib/shell-constants";

const LineCounts = Schema.Struct({ total: Schema.Number, covered: Schema.Number });
const Summary = Schema.parseJson(Schema.Record({ key: Schema.String, value: Schema.Struct({ lines: LineCounts }) }));

export interface FileMiss {
  path: string;
  missed: number;
}

export interface FolderCoverage {
  folder: string;
  covered: number;
  total: number;
  files: FileMiss[];
}

export interface Shortfall {
  folder: string;
  floor: number;
  percent: number;
  gap: number;
  needed: number;
  total: number;
  worst: FileMiss[];
}

export const percentOf = (folder: FolderCoverage): number => (folder.total === 0 ? 0 : (folder.covered / folder.total) * FULL_PERCENT);

const shown = (value: number): string => (Math.floor(value * FULL_PERCENT) / FULL_PERCENT).toFixed(PERCENT_DECIMALS);

const shownUp = (value: number): string => (Math.ceil(value * FULL_PERCENT) / FULL_PERCENT).toFixed(PERCENT_DECIMALS);

const relative = (file: string, root: string): string => (file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file);

export function parseSummary(text: string, root: string): Either.Either<Record<string, { total: number; covered: number }>, string> {
  const decoded = Schema.decodeUnknownEither(Summary)(text);
  if (Either.isLeft(decoded)) return Either.left(`${COVERAGE_SUMMARY_FILE} is not the json-summary that vitest's v8 coverage writes`);
  const files = Object.entries(decoded.right).filter(([file]) => file !== "total");
  return Either.right(Object.fromEntries(files.map(([file, value]) => [relative(file, root), value.lines])));
}

export function byFolder(files: Record<string, { total: number; covered: number }>, folders: ReadonlyArray<string>): FolderCoverage[] {
  return folders.map((folder) => {
    const inside = Object.entries(files).filter(([path]) => path.startsWith(`${folder}/`));
    return {
      folder,
      covered: inside.reduce((sum, [, lines]) => sum + lines.covered, 0),
      total: inside.reduce((sum, [, lines]) => sum + lines.total, 0),
      files: inside.map(([path, lines]) => ({ path, missed: lines.total - lines.covered })),
    };
  });
}

export function shortfalls(folders: ReadonlyArray<FolderCoverage>, floors: Readonly<Record<string, number>>): Shortfall[] {
  return folders.flatMap((folder) => {
    const floor = floors[folder.folder] ?? FULL_PERCENT;
    const percent = percentOf(folder);
    if (folder.total > 0 && percent >= floor) return [];
    const worst = folder.files
      .filter((file) => file.missed > 0)
      .sort((a, b) => b.missed - a.missed || a.path.localeCompare(b.path))
      .slice(0, COVERAGE_WORST_FILES);
    const needed = Math.ceil((floor * folder.total) / FULL_PERCENT) - folder.covered;
    return [{ folder: folder.folder, floor, percent, gap: floor - percent, needed, total: folder.total, worst }];
  });
}

export function shortfallLine(short: Shortfall): string {
  if (short.total === 0) {
    return (
      `coverage: ${short.folder} has no measured lines, so its ${short.floor}% floor cannot hold. ` +
      `Do this instead: if the folder moved, rename its key in COVERAGE_FLOORS (scripts/lib/coverage-constants.ts); if its tests stopped loading it, find out why. See ${COVERAGE_DOC}.`
    );
  }
  const where = short.worst.map((file) => `${file.path} (${file.missed} lines)`).join(", ");
  return (
    `coverage: ${short.folder} runs ${shown(short.percent)}% of its lines, ${shownUp(short.gap)} points under its ${short.floor}% floor: ` +
    `${short.needed} more of its ${short.total} lines must run. ` +
    `Do this instead: write a test beside each file below, in its __tests__/ folder, that calls the code those lines hold and asserts on the result; ` +
    `never lower the floor and never add a test that asserts nothing. Most lines not run: ${where}. See ${COVERAGE_DOC}.`
  );
}

export const passLine = (folder: FolderCoverage, floor: number): string =>
  `ok: ${folder.folder} ${shown(percentOf(folder))}% of ${folder.total} lines (floor ${floor}%)`;

export const vitestArgs = (reportDir: string, folders: ReadonlyArray<string>): string[] => [
  "vitest",
  "run",
  ...COVERAGE_TEST_ROOTS,
  "--coverage.enabled",
  "--coverage.reporter=json-summary",
  `--coverage.reportsDirectory=${reportDir}`,
  ...folders.map((folder) => `--coverage.include=${folder}/**`),
];

export function checkFloors(shell: Shell, floors: Readonly<Record<string, number>> = COVERAGE_FLOORS): number {
  const folders = Object.keys(floors);
  const reportDir = shell.tempDir(COVERAGE_TEMP_PREFIX);
  const result: RunResult = shell.run(BUNX_BIN, vitestArgs(reportDir, folders), shell.cwd);
  const text = shell.read(join(reportDir, COVERAGE_SUMMARY_FILE));
  shell.remove(reportDir);
  if (result.code !== EXIT_OK) {
    shell.err(`coverage: the unit tests failed, so no coverage was measured. Do this instead: run \`bun run test\` and fix the failing test.\n${tail(result)}`);
    return EXIT_FAIL;
  }
  if (text === undefined) {
    shell.err(`coverage: vitest wrote no ${COVERAGE_SUMMARY_FILE}. Do this instead: check that @vitest/coverage-v8 is installed at vitest's version.`);
    return EXIT_FAIL;
  }
  const parsed = parseSummary(text, shell.cwd);
  if (Either.isLeft(parsed)) {
    shell.err(`coverage: ${parsed.left}`);
    return EXIT_FAIL;
  }
  const measured = byFolder(parsed.right, folders);
  const short = shortfalls(measured, floors);
  for (const folder of measured) {
    if (!short.some((entry) => entry.folder === folder.folder)) shell.out(passLine(folder, floors[folder.folder] ?? FULL_PERCENT));
  }
  for (const entry of short) shell.err(shortfallLine(entry));
  return short.length === 0 ? EXIT_OK : EXIT_FAIL;
}

if (import.meta.main) {
  process.exit(checkFloors(realShell()));
}
