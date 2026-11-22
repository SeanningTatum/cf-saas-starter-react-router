#!/usr/bin/env bun
import { Either } from "effect";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  DEV_VARS_FILE,
  HEAD_REF,
  LIGHTHOUSE_CLI,
  LIMITS_FILE,
  LOCAL_HOST,
  MIGRATE_ARGS,
  PORT,
  PUBLIC_PAGES,
  REPORT_JSON_SUFFIX,
  RUNS,
  SECRET_BYTES,
  SEEDED_USER,
  SEED_ARGS,
  SERVER_POLL_MS,
  SERVER_WAIT_MS,
  SIGNED_IN_PAGES,
  SIGN_IN_PATH,
  USAGE,
  VALUE_FLAGS,
  WORKTREE_PREFIX,
  devVars,
  lighthouseArgs,
  previewArgs,
} from "./lib/lighthouse-constants";
import { breaches, metricsOf, parseLimits, renderLighthouse, summarize, type Metrics, type PageResult, type RefResult } from "./lib/lighthouse-report";
import { addWorktree, childEnv, realShell, removeWorktree, resolveCommit, step, type Shell } from "./lib/shell";
import { BUILD_ARGS, BUN_BIN, CI_ENV, EXIT_FAIL, EXIT_OK, EXIT_USAGE, INSTALL_ARGS } from "./lib/shell-constants";

export interface Deps extends Shell {
  start: (command: string, args: string[], cwd: string) => { stop: () => Promise<void> };
  ready: (url: string) => Promise<boolean>;
  signIn: (origin: string) => Promise<Either.Either<string, string>>;
  mkdir: (dir: string) => void;
  secret: () => string;
}

export interface Options {
  base: string | undefined;
  reports: string | undefined;
  json: string | undefined;
  markdown: string | undefined;
}

export function parseArgs(argv: string[]): Either.Either<Options, string> {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] ?? "";
    const value = argv[i + 1];
    if (!VALUE_FLAGS.has(flag) || !value || value.startsWith("--")) return Either.left(USAGE);
    values.set(flag, value);
  }
  return Either.right({ base: values.get("--base"), reports: values.get("--reports"), json: values.get("--json"), markdown: values.get("--markdown") });
}

export const pageSlug = (page: string): string => page.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";

export const prepare = (deps: Deps, dir: string): Either.Either<void, string> =>
  Either.gen(function* () {
    yield* step(deps, BUN_BIN, INSTALL_ARGS, dir);
    deps.write(join(dir, DEV_VARS_FILE), devVars(PORT, deps.secret()));
    yield* step(deps, BUN_BIN, MIGRATE_ARGS, dir);
    yield* step(deps, BUN_BIN, SEED_ARGS, dir);
    yield* step(deps, BUN_BIN, BUILD_ARGS, dir);
  });

export async function measurePages(deps: Deps, options: Options, label: string, origin: string): Promise<Either.Either<PageResult[], string>> {
  const cookie = await deps.signIn(origin);
  if (Either.isLeft(cookie)) return Either.left(cookie.left);
  const reports = options.reports ?? deps.tempDir(WORKTREE_PREFIX);
  deps.mkdir(reports);
  const cli = join(deps.cwd, LIGHTHOUSE_CLI);
  const pages = [...PUBLIC_PAGES.map((page) => ({ page, cookie: undefined })), ...SIGNED_IN_PAGES.map((page) => ({ page, cookie: cookie.right }))];
  const results: PageResult[] = [];
  for (const { page, cookie: header } of pages) {
    const runs: Metrics[] = [];
    for (let i = 1; i <= RUNS; i++) {
      const output = join(reports, `${label}-${pageSlug(page)}-${i}`);
      const ran = step(deps, BUN_BIN, lighthouseArgs(cli, `${origin}${page}`, output, header), deps.cwd);
      const metrics = Either.flatMap(ran, () => metricsOf(deps.read(`${output}${REPORT_JSON_SUFFIX}`) ?? "", `${origin}${page}`));
      if (Either.isLeft(metrics)) return Either.left(`${page}, run ${i}: ${metrics.left}`);
      runs.push(metrics.right);
    }
    results.push(summarize(page, runs));
  }
  return Either.right(results);
}

async function serve(deps: Deps, options: Options, ref: string, label: string, dir: string): Promise<Either.Either<PageResult[], string>> {
  const prepared = prepare(deps, dir);
  if (Either.isLeft(prepared)) return Either.left(prepared.left);
  const origin = `${LOCAL_HOST}:${PORT}`;
  const server = deps.start(BUN_BIN, previewArgs(PORT), dir);
  const pages = (await deps.ready(origin))
    ? await measurePages(deps, options, label, origin)
    : Either.left(`the production build of ${ref} never answered on ${origin}`);
  await server.stop();
  return pages;
}

export async function measureRef(deps: Deps, options: Options, ref: string, label: string): Promise<Either.Either<RefResult, string>> {
  const dir = Either.flatMap(resolveCommit(deps, ref), (sha) => addWorktree(deps, sha, WORKTREE_PREFIX));
  if (Either.isLeft(dir)) return Either.left(dir.left);
  const pages = await serve(deps, options, ref, label, dir.right);
  removeWorktree(deps, dir.right);
  return Either.map(pages, (results) => ({ ref, pages: results }));
}

export async function run(argv: string[], deps: Deps): Promise<number> {
  const options = parseArgs(argv);
  if (Either.isLeft(options)) {
    deps.err(options.left);
    return EXIT_USAGE;
  }
  const limits = parseLimits(deps.read(join(deps.cwd, LIMITS_FILE)) ?? "");
  if (Either.isLeft(limits)) {
    deps.err(limits.left);
    return EXIT_FAIL;
  }
  const head = await measureRef(deps, options.right, HEAD_REF, "head");
  if (Either.isLeft(head)) {
    deps.err(head.left);
    return EXIT_FAIL;
  }
  const base = options.right.base === undefined ? undefined : await measureRef(deps, options.right, options.right.base, "base");
  if (base !== undefined && Either.isLeft(base)) {
    deps.err(base.left);
    return EXIT_FAIL;
  }
  const baseResult = base === undefined ? undefined : base.right;
  const markdown = renderLighthouse(head.right, baseResult, limits.right);
  if (options.right.json) deps.write(options.right.json, JSON.stringify({ head: head.right, base: baseResult }, null, 2));
  if (options.right.markdown) deps.write(options.right.markdown, `${markdown}\n`);
  for (const line of breaches(head.right, limits.right)) deps.err(`::warning::Lighthouse: ${line}`);
  deps.out(markdown);
  return EXIT_OK;
}

const cookieOf = (headers: Headers): string => headers.getSetCookie().map((line) => line.split(";")[0]).join("; ");

export function realDeps(): Deps {
  return {
    ...realShell(CI_ENV),
    start: (command, args, cwd) => {
      const child = spawn(command, args, { cwd, env: childEnv(CI_ENV), stdio: "ignore", detached: true });
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      return {
        stop: () => {
          if (child.pid !== undefined && child.exitCode === null) process.kill(-child.pid, "SIGTERM");
          return exited;
        },
      };
    },
    ready: async (url) => {
      for (let waited = 0; waited < SERVER_WAIT_MS; waited += SERVER_POLL_MS) {
        const answered = await fetch(url).then((response) => response.ok, () => false);
        if (answered) return true;
        await sleep(SERVER_POLL_MS);
      }
      return false;
    },
    signIn: (origin) =>
      fetch(`${origin}${SIGN_IN_PATH}`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(SEEDED_USER) }).then(
        (response) => (response.ok && cookieOf(response.headers) ? Either.right(cookieOf(response.headers)) : Either.left(`signing in as the seeded user returned ${response.status}`)),
        (error: Error) => Either.left(`signing in as the seeded user failed: ${error.message}`),
      ),
    mkdir: (dir) => mkdirSync(dir, { recursive: true }),
    secret: () => randomBytes(SECRET_BYTES).toString("hex"),
  };
}

if (import.meta.main) {
  process.exit(await run(process.argv.slice(2), realDeps()));
}
