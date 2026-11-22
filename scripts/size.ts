#!/usr/bin/env bun
import { Either } from "effect";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  ASSET_URL_PREFIX,
  BUILD_ARGS,
  BUN_BIN,
  CACHE_DIR,
  CHILD_MAX_BUFFER_BYTES,
  CLIENT_ASSETS_DIR,
  DRY_RUN_ARGS,
  EXIT_FAIL,
  EXIT_OK,
  EXIT_USAGE,
  GIT_BIN,
  GIT_ENV_PREFIX,
  INSTALL_ARGS,
  JSON_SUFFIX,
  MANIFEST_PREFIX,
  USAGE,
  WORKTREE_PREFIX,
} from "./lib/size-constants";
import {
  compare,
  loadTimeLine,
  measure,
  parseManifest,
  parseReport,
  parseWorkerGzip,
  prSection,
  renderComparison,
  renderTable,
  type SizeReport,
} from "./lib/size-report";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface Deps {
  cwd: string;
  run: (command: string, args: string[], cwd: string) => RunResult;
  read: (path: string) => string | undefined;
  write: (path: string, text: string) => void;
  list: (dir: string) => string[];
  gzipSize: (path: string) => number;
  tempDir: (prefix: string) => string;
  remove: (path: string) => void;
  out: (text: string) => void;
  err: (text: string) => void;
}

export interface Options {
  base: string | undefined;
  json: string | undefined;
  markdown: string | undefined;
  prBody: boolean;
}

export function parseArgs(argv: string[]): Either.Either<Options, string> {
  const options: Options = { base: undefined, json: undefined, markdown: undefined, prBody: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--pr-body") {
      options.prBody = true;
      continue;
    }
    const value = argv[i + 1];
    if ((flag !== "--base" && flag !== "--json" && flag !== "--markdown") || !value || value.startsWith("--")) return Either.left(USAGE);
    options[flag.slice(2) as "base" | "json" | "markdown"] = value;
    i++;
  }
  if (options.prBody && (!options.base || options.base.endsWith(JSON_SUFFIX))) return Either.left(USAGE);
  return Either.right(options);
}

const tail = (result: RunResult): string => `${result.stderr}${result.stdout}`.trim().split("\n").slice(-5).join("\n");

const step = (deps: Deps, command: string, args: string[], cwd: string): Either.Either<RunResult, string> => {
  const result = deps.run(command, args, cwd);
  return result.code === EXIT_OK ? Either.right(result) : Either.left(`\`${command} ${args.join(" ")}\` failed in ${cwd}:\n${tail(result)}`);
};

export const measureDir = (deps: Deps, dir: string): Either.Either<SizeReport, string> =>
  Either.gen(function* () {
    yield* step(deps, BUN_BIN, BUILD_ARGS, dir);
    const dryRun = yield* step(deps, BUN_BIN, DRY_RUN_ARGS, dir);
    const workerGzip = yield* parseWorkerGzip(`${dryRun.stdout}\n${dryRun.stderr}`);
    const assetsDir = join(dir, CLIENT_ASSETS_DIR);
    const files = deps.list(assetsDir);
    const manifestFile = files.find((file) => file.startsWith(MANIFEST_PREFIX));
    const manifestText = manifestFile === undefined ? undefined : deps.read(join(assetsDir, manifestFile));
    if (manifestText === undefined) return yield* Either.left(`no React Router manifest in ${assetsDir}`);
    const manifest = yield* parseManifest(manifestText);
    const sizes = Object.fromEntries(files.map((file) => [`${ASSET_URL_PREFIX}${file}`, deps.gzipSize(join(assetsDir, file))]));
    return measure(manifest, sizes, workerGzip);
  });

export const measureRef = (deps: Deps, ref: string): Either.Either<SizeReport, string> =>
  Either.gen(function* () {
    const saved = ref.endsWith(JSON_SUFFIX) ? deps.read(ref) : undefined;
    if (saved !== undefined) return yield* parseReport(saved);
    const sha = (yield* step(deps, GIT_BIN, ["rev-parse", "--verify", `${ref}^{commit}`], deps.cwd)).stdout.trim();
    const cachePath = join(deps.cwd, CACHE_DIR, `${sha}${JSON_SUFFIX}`);
    const cached = deps.read(cachePath);
    const fromCache = cached === undefined ? undefined : parseReport(cached);
    if (fromCache !== undefined && Either.isRight(fromCache)) return fromCache.right;
    const dir = deps.tempDir(WORKTREE_PREFIX);
    yield* step(deps, GIT_BIN, ["worktree", "add", "--detach", dir, sha], deps.cwd);
    const report = Either.flatMap(step(deps, BUN_BIN, INSTALL_ARGS, dir), () => measureDir(deps, dir));
    deps.run(GIT_BIN, ["worktree", "remove", "--force", dir], deps.cwd);
    deps.remove(dir);
    if (Either.isRight(report)) deps.write(cachePath, JSON.stringify(report.right));
    return yield* report;
  });

const changedPaths = (deps: Deps, base: string): Either.Either<string[], string> =>
  Either.map(step(deps, GIT_BIN, ["diff", "--name-only", `${base}...HEAD`], deps.cwd), (result) =>
    result.stdout.split("\n").map((line) => line.trim()).filter(Boolean),
  );

export const report = (deps: Deps, options: Options): Either.Either<{ head: SizeReport; markdown: string }, string> =>
  Either.gen(function* () {
    const head = yield* measureDir(deps, deps.cwd);
    if (options.base === undefined) return { head, markdown: renderTable(head) };
    const rows = compare(yield* measureRef(deps, options.base), head);
    if (options.prBody) return { head, markdown: prSection(yield* changedPaths(deps, options.base), rows) };
    return { head, markdown: `${renderComparison(rows)}\n\n${loadTimeLine(rows)}` };
  });

export function run(argv: string[], deps: Deps): number {
  const options = parseArgs(argv);
  if (Either.isLeft(options)) {
    deps.err(options.left);
    return EXIT_USAGE;
  }
  const result = report(deps, options.right);
  if (Either.isLeft(result)) {
    deps.err(result.left);
    return EXIT_FAIL;
  }
  if (options.right.json) deps.write(options.right.json, JSON.stringify(result.right.head, null, 2));
  if (options.right.markdown) deps.write(options.right.markdown, `${result.right.markdown}\n`);
  deps.out(result.right.markdown);
  return EXIT_OK;
}

const childEnv = (): Record<string, string> =>
  Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => !entry[0].startsWith(GIT_ENV_PREFIX) && entry[1] !== undefined));

export function realDeps(): Deps {
  return {
    cwd: process.cwd(),
    run: (command, args, cwd) => {
      const result = spawnSync(command, args, { cwd, env: childEnv(), encoding: "utf8", maxBuffer: CHILD_MAX_BUFFER_BYTES });
      if (result.error) return { code: EXIT_FAIL, stdout: "", stderr: result.error.message };
      return { code: result.status ?? EXIT_FAIL, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    },
    read: (path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined),
    write: (path, text) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    },
    list: (dir) => (existsSync(dir) ? readdirSync(dir) : []),
    gzipSize: (path) => gzipSync(readFileSync(path)).length,
    tempDir: (prefix) => mkdtempSync(join(tmpdir(), prefix)),
    remove: (path) => rmSync(path, { recursive: true, force: true }),
    out: (text) => console.log(text),
    err: (text) => console.error(text),
  };
}

if (import.meta.main) {
  process.exit(run(process.argv.slice(2), realDeps()));
}
