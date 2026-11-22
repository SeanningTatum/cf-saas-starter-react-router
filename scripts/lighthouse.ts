#!/usr/bin/env bun
import { Either } from "effect";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  BUILD_ARGS,
  BUN_BIN,
  CHILD_MAX_BUFFER_BYTES,
  DEFAULT_PORT,
  DEFAULT_RUNS,
  DEV_VARS_FILE,
  EXIT_FAIL,
  EXIT_OK,
  EXIT_USAGE,
  GIT_BIN,
  GIT_ENV_PREFIX,
  HEAD_REF,
  INSTALL_ARGS,
  LIGHTHOUSE_CLI,
  LIMITS_FILE,
  LOCAL_HOST,
  MIGRATE_ARGS,
  PUBLIC_PAGES,
  REPORT_JSON_SUFFIX,
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

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface Deps {
  cwd: string;
  run: (command: string, args: string[], cwd: string) => RunResult;
  start: (command: string, args: string[], cwd: string) => { stop: () => Promise<void> };
  ready: (url: string) => Promise<boolean>;
  signIn: (origin: string) => Promise<Either.Either<string, string>>;
  read: (path: string) => string | undefined;
  write: (path: string, text: string) => void;
  mkdir: (dir: string) => void;
  tempDir: (prefix: string) => string;
  remove: (path: string) => void;
  secret: () => string;
  out: (text: string) => void;
  err: (text: string) => void;
}

export interface Options {
  base: string | undefined;
  runs: number;
  port: number;
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
  const runs = Number(values.get("--runs") ?? DEFAULT_RUNS);
  const port = Number(values.get("--port") ?? DEFAULT_PORT);
  if (!Number.isInteger(runs) || runs < 1 || !Number.isInteger(port) || port < 1) return Either.left(USAGE);
  return Either.right({
    base: values.get("--base"),
    runs,
    port,
    reports: values.get("--reports"),
    json: values.get("--json"),
    markdown: values.get("--markdown"),
  });
}

const tail = (result: RunResult): string => `${result.stderr}${result.stdout}`.trim().split("\n").slice(-5).join("\n");

const step = (deps: Deps, command: string, args: string[], cwd: string): Either.Either<RunResult, string> => {
  const result = deps.run(command, args, cwd);
  return result.code === EXIT_OK ? Either.right(result) : Either.left(`\`${command} ${args.join(" ")}\` failed in ${cwd}:\n${tail(result)}`);
};

export const pageSlug = (page: string): string => page.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";

export const prepare = (deps: Deps, dir: string, port: number): Either.Either<void, string> =>
  Either.gen(function* () {
    yield* step(deps, BUN_BIN, INSTALL_ARGS, dir);
    deps.write(join(dir, DEV_VARS_FILE), devVars(port, deps.secret()));
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
    for (let i = 1; i <= options.runs; i++) {
      const output = join(reports, `${label}-${pageSlug(page)}-${i}`);
      const ran = step(deps, BUN_BIN, lighthouseArgs(cli, `${origin}${page}`, output, header), deps.cwd);
      const metrics = Either.flatMap(ran, () => metricsOf(deps.read(`${output}${REPORT_JSON_SUFFIX}`) ?? ""));
      if (Either.isLeft(metrics)) return Either.left(`${page}, run ${i}: ${metrics.left}`);
      runs.push(metrics.right);
    }
    results.push(summarize(page, runs));
  }
  return Either.right(results);
}

async function serve(deps: Deps, options: Options, ref: string, label: string, dir: string): Promise<Either.Either<PageResult[], string>> {
  const prepared = prepare(deps, dir, options.port);
  if (Either.isLeft(prepared)) return Either.left(prepared.left);
  const origin = `${LOCAL_HOST}:${options.port}`;
  const server = deps.start(BUN_BIN, previewArgs(options.port), dir);
  const pages = (await deps.ready(origin))
    ? await measurePages(deps, options, label, origin)
    : Either.left(`the production build of ${ref} never answered on ${origin}`);
  await server.stop();
  return pages;
}

export async function measureRef(deps: Deps, options: Options, ref: string, label: string): Promise<Either.Either<RefResult, string>> {
  const sha = step(deps, GIT_BIN, ["rev-parse", "--verify", `${ref}^{commit}`], deps.cwd);
  if (Either.isLeft(sha)) return Either.left(sha.left);
  const dir = deps.tempDir(WORKTREE_PREFIX);
  const added = step(deps, GIT_BIN, ["worktree", "add", "--detach", dir, sha.right.stdout.trim()], deps.cwd);
  if (Either.isLeft(added)) return Either.left(added.left);
  const pages = await serve(deps, options, ref, label, dir);
  deps.run(GIT_BIN, ["worktree", "remove", "--force", dir], deps.cwd);
  deps.remove(dir);
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
  const markdown = renderLighthouse(head.right, baseResult, limits.right, options.right.runs);
  if (options.right.json) deps.write(options.right.json, JSON.stringify({ head: head.right, base: baseResult }, null, 2));
  if (options.right.markdown) deps.write(options.right.markdown, `${markdown}\n`);
  for (const line of breaches(head.right, limits.right)) deps.err(`::warning::Lighthouse: ${line}`);
  deps.out(markdown);
  return EXIT_OK;
}

const childEnv = (): Record<string, string> => ({
  ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => !entry[0].startsWith(GIT_ENV_PREFIX) && entry[1] !== undefined)),
  CI: "1",
});

const cookieOf = (headers: Headers): string => headers.getSetCookie().map((line) => line.split(";")[0]).join("; ");

export function realDeps(): Deps {
  return {
    cwd: process.cwd(),
    run: (command, args, cwd) => {
      const result = spawnSync(command, args, { cwd, env: childEnv(), encoding: "utf8", maxBuffer: CHILD_MAX_BUFFER_BYTES });
      if (result.error) return { code: EXIT_FAIL, stdout: "", stderr: result.error.message };
      return { code: result.status ?? EXIT_FAIL, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    },
    start: (command, args, cwd) => {
      const child = spawn(command, args, { cwd, env: childEnv(), stdio: "ignore", detached: true });
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
    read: (path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined),
    write: (path, text) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    },
    mkdir: (dir) => mkdirSync(dir, { recursive: true }),
    tempDir: (prefix) => mkdtempSync(join(tmpdir(), prefix)),
    remove: (path) => rmSync(path, { recursive: true, force: true }),
    secret: () => randomBytes(SECRET_BYTES).toString("hex"),
    out: (text) => console.log(text),
    err: (text) => console.error(text),
  };
}

if (import.meta.main) {
  process.exit(await run(process.argv.slice(2), realDeps()));
}
