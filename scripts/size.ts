#!/usr/bin/env bun
import { Either } from "effect";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { addWorktree, realShell, removeWorktree, resolveCommit, step, type Shell } from "./lib/shell";
import { BUILD_ARGS, BUN_BIN, CI_ENV, EXIT_FAIL, EXIT_OK, EXIT_USAGE, GIT_BIN, INSTALL_ARGS } from "./lib/shell-constants";
import { ASSET_URL_PREFIX, CACHE_DIR, CLIENT_ASSETS_DIR, DRY_RUN_ARGS, JSON_SUFFIX, MANIFEST_PREFIX, USAGE, WORKTREE_PREFIX } from "./lib/size-constants";
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

export interface Deps extends Shell {
  list: (dir: string) => string[];
  gzipSize: (path: string) => number;
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
    const sha = yield* resolveCommit(deps, ref);
    const cachePath = join(deps.cwd, CACHE_DIR, `${sha}${JSON_SUFFIX}`);
    const cached = deps.read(cachePath);
    const fromCache = cached === undefined ? undefined : parseReport(cached);
    if (fromCache !== undefined && Either.isRight(fromCache)) return fromCache.right;
    const dir = yield* addWorktree(deps, sha, WORKTREE_PREFIX);
    const report = Either.flatMap(step(deps, BUN_BIN, INSTALL_ARGS, dir), () => measureDir(deps, dir));
    removeWorktree(deps, dir);
    if (Either.isRight(report)) deps.write(cachePath, JSON.stringify(report.right));
    return yield* report;
  });

const changedPaths = (deps: Deps, base: string): Either.Either<string[], string> =>
  Either.map(step(deps, GIT_BIN, ["diff", "--name-only", `${base}...HEAD`], deps.cwd), (result) =>
    result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
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

export const realDeps = (): Deps => ({
  ...realShell(CI_ENV),
  list: (dir) => (existsSync(dir) ? readdirSync(dir) : []),
  gzipSize: (path) => gzipSync(readFileSync(path)).length,
});

if (import.meta.main) {
  process.exit(run(process.argv.slice(2), realDeps()));
}
