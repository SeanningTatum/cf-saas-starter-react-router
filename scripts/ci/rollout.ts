#!/usr/bin/env bun
import { Either, Schema } from "effect";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readProjectName } from "./deploy-gate";
import { DEFAULT_OPTIONS, fetchAnswer, parseOrigin, parseRelease, smokeCheck, type SmokeDeps, type SmokeOptions } from "./smoke-check";
import {
  CLOSE_BRACE,
  DEPLOY_TIMEOUT_MS,
  ENV_OUTPUT,
  ENV_RELEASE,
  ENV_SHA,
  ENV_SUMMARY,
  ENV_URL,
  ERROR_NO_NAME,
  ERROR_NO_RELEASE,
  ERROR_NO_VERSION_ID,
  ERROR_STATUS,
  ERROR_UPLOAD,
  EXIT_FAIL,
  EXIT_OK,
  FULL_TRAFFIC,
  NO_DEPLOYMENTS_MARKER,
  OPEN_BRACE,
  OUTCOME_FAILED,
  OUTCOME_PROMOTED,
  OUTCOME_ROLLBACK_FAILED,
  OUTCOME_ROLLED_BACK,
  PRODUCTION_ENVIRONMENT,
  ROLLOUT_STEPS,
  SHA_PREFIX_LENGTH,
  SOAK_MS,
  STATUS_TIMEOUT_MS,
  SUCCESS_STATUS,
  SUMMARY_HEADING,
  TIMEOUT_CODE,
  UPLOAD_TIMEOUT_MS,
  VERSION_ID_LINE,
  WARNING_FIRST_DEPLOY,
  WARNING_NO_URL,
  WRANGLER_COMMAND,
  deployFailed,
  firstDeployFailedLine,
  promotedLine,
  rollbackFailedLine,
  rollbackMessage,
  rolledBackLine,
  soakLine,
  stepLine,
  stepMessage,
  summaryAt,
  summaryOutcome,
  summaryStep,
  summaryVersions,
  uploadedLine,
  versionMessage,
} from "../lib/rollout-constants";
import { WORKER_NAME_RULE } from "../lib/smoke-check-constants";

export interface CommandResult {
  readonly status: number;
  readonly output: string;
  readonly timedOut: boolean;
}

export interface Deps extends SmokeDeps {
  readonly env: Record<string, string | undefined>;
  readonly runCommand: (argv: readonly string[], timeoutMs: number) => CommandResult;
  readonly appendFile: (file: string, text: string) => void;
  readonly readFile: (file: string) => string | undefined;
  readonly wranglerPath: string;
}

export interface RolloutOptions {
  readonly soakMs: number;
  readonly smoke: SmokeOptions;
  readonly steps: readonly number[];
}

export const DEFAULT_ROLLOUT: RolloutOptions = { soakMs: SOAK_MS, smoke: DEFAULT_OPTIONS, steps: ROLLOUT_STEPS };

export interface Plan {
  readonly steps: readonly number[];
  readonly checked: boolean;
}

interface Context {
  readonly deps: Deps;
  readonly options: RolloutOptions;
  readonly release: string;
  readonly worker: string;
  readonly origin: string | undefined;
  readonly next: string;
  readonly previous: string | undefined;
  readonly report: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const Deployment = Schema.parseJson(
  Schema.Struct({
    versions: Schema.Array(Schema.Struct({ version_id: Schema.String.pipe(Schema.pattern(UUID)), percentage: Schema.Number })),
  }),
);
const decodeDeployment = Schema.decodeUnknownEither(Deployment);

export function planRollout(hasPrevious: boolean, hasUrl: boolean, steps: readonly number[] = ROLLOUT_STEPS): Plan {
  if (!hasPrevious || !hasUrl) return { steps: [FULL_TRAFFIC], checked: hasUrl };
  return { steps: steps.at(-1) === FULL_TRAFFIC ? steps : [...steps, FULL_TRAFFIC], checked: true };
}

export function trafficSpecs(next: string, previous: string | undefined, percent: number): string[] {
  if (previous === undefined || percent >= FULL_TRAFFIC) return [`${next}@${FULL_TRAFFIC}%`];
  return [`${next}@${percent}%`, `${previous}@${FULL_TRAFFIC - percent}%`];
}

export function parseVersionId(output: string): string | undefined {
  return VERSION_ID_LINE.exec(output)?.[1];
}

export function parseCurrentVersion(output: string): string | undefined {
  const first = output.indexOf(OPEN_BRACE);
  const last = output.lastIndexOf(CLOSE_BRACE);
  if (first < 0 || last < first) return undefined;
  const decoded = decodeDeployment(output.slice(first, last + 1));
  if (Either.isLeft(decoded)) return undefined;
  const ranked = [...decoded.right.versions].sort((a, b) => b.percentage - a.percentage);
  return ranked[0]?.version_id;
}

export const statusArgv = (): string[] => [...WRANGLER_COMMAND, "deployments", "status", "--json"];

export const uploadArgv = (release: string, sha: string): string[] => [
  ...WRANGLER_COMMAND,
  "versions",
  "upload",
  "--var",
  `RELEASE_VERSION:${release}`,
  "--var",
  `ENVIRONMENT:${PRODUCTION_ENVIRONMENT}`,
  "--message",
  versionMessage(release, sha),
];

export const deployArgv = (specs: readonly string[], message: string): string[] => [
  ...WRANGLER_COMMAND,
  "versions",
  "deploy",
  ...specs,
  "--message",
  message,
  "--yes",
];

const shortSha = (sha: string | undefined): string => (sha ?? "").trim().slice(0, SHA_PREFIX_LENGTH);

const succeeded = (result: CommandResult): boolean => !result.timedOut && result.status === SUCCESS_STATUS;

function finish(ctx: Context, outcome: string, lines: readonly string[], failedAt?: number): number {
  const { deps } = ctx;
  for (const line of lines) deps.log(line);
  const summary = deps.env[ENV_SUMMARY];
  const body = [
    SUMMARY_HEADING,
    "",
    summaryOutcome(outcome),
    summaryVersions(ctx.next, ctx.previous),
    ...ctx.report,
    ...(failedAt === undefined ? [] : [summaryAt(failedAt)]),
  ];
  if (summary) deps.appendFile(summary, `${body.join("\n")}\n`);
  const output = deps.env[ENV_OUTPUT];
  const fields = [`outcome=${outcome}`, `version_id=${ctx.next}`, `previous_version_id=${ctx.previous ?? ""}`, `failed_at=${failedAt ?? ""}`];
  if (output) deps.appendFile(output, `${fields.join("\n")}\n`);
  return outcome === OUTCOME_PROMOTED ? EXIT_OK : EXIT_FAIL;
}

function rollBack(ctx: Context, percent: number): number {
  const { previous } = ctx;
  if (previous === undefined) return finish(ctx, OUTCOME_FAILED, [firstDeployFailedLine(ctx.next)], percent);
  const result = ctx.deps.runCommand(deployArgv(trafficSpecs(previous, undefined, FULL_TRAFFIC), rollbackMessage(ctx.release, percent)), DEPLOY_TIMEOUT_MS);
  return succeeded(result)
    ? finish(ctx, OUTCOME_ROLLED_BACK, [rolledBackLine(percent, previous)], percent)
    : finish(ctx, OUTCOME_ROLLBACK_FAILED, [rollbackFailedLine(previous)], percent);
}

async function checkStep(ctx: Context, percent: number): Promise<boolean> {
  const { deps, options, origin } = ctx;
  if (origin === undefined) return true;
  deps.log(soakLine(options.soakMs));
  await deps.sleep(options.soakMs);
  const verdict = await smokeCheck({ origin, release: ctx.release, pin: { worker: ctx.worker, versionId: ctx.next } }, deps, options.smoke);
  ctx.report.push(summaryStep(percent, verdict.ok));
  return verdict.ok;
}

async function rollOut(ctx: Context): Promise<number> {
  const plan = planRollout(ctx.previous !== undefined, ctx.origin !== undefined, ctx.options.steps);
  if (!plan.checked) ctx.deps.log(WARNING_NO_URL);
  for (const percent of plan.steps) {
    ctx.deps.log(stepLine(percent, ctx.next));
    const moved = ctx.deps.runCommand(deployArgv(trafficSpecs(ctx.next, ctx.previous, percent), stepMessage(ctx.release, percent)), DEPLOY_TIMEOUT_MS);
    if (!succeeded(moved)) {
      ctx.deps.log(deployFailed(percent));
      return rollBack(ctx, percent);
    }
    if (!(await checkStep(ctx, percent))) return rollBack(ctx, percent);
  }
  return finish(ctx, OUTCOME_PROMOTED, [promotedLine(ctx.next, ctx.release)]);
}

type Previous = { readonly ok: true; readonly id: string | undefined } | { readonly ok: false };

function readPrevious(deps: Deps): Previous {
  const status = deps.runCommand(statusArgv(), STATUS_TIMEOUT_MS);
  if (!succeeded(status)) {
    if (status.output.includes(NO_DEPLOYMENTS_MARKER)) {
      deps.log(WARNING_FIRST_DEPLOY);
      return { ok: true, id: undefined };
    }
    return { ok: false };
  }
  const id = parseCurrentVersion(status.output);
  return id === undefined ? { ok: false } : { ok: true, id };
}

function readInputs(deps: Deps): Either.Either<{ release: string; worker: string; origin: string | undefined }, string> {
  return Either.gen(function* () {
    const release = yield* Either.flatMap(parseRelease(deps.env[ENV_RELEASE]?.trim() || undefined), (value) =>
      value === undefined ? Either.left(ERROR_NO_RELEASE) : Either.right(value),
    ).pipe(Either.mapLeft(() => ERROR_NO_RELEASE));
    const worker = yield* Either.flatMap(readProjectName(deps.readFile(deps.wranglerPath) ?? ""), (name) =>
      WORKER_NAME_RULE.test(name) ? Either.right(name) : Either.left(ERROR_NO_NAME),
    ).pipe(Either.mapLeft(() => ERROR_NO_NAME));
    const rawUrl = deps.env[ENV_URL]?.trim() ?? "";
    const origin = rawUrl === "" ? undefined : yield* Either.mapLeft(parseOrigin(rawUrl), (reason) => `::error::${ENV_URL}: ${reason}`);
    return { release, worker, origin };
  });
}

export async function run(deps: Deps, options: RolloutOptions = DEFAULT_ROLLOUT): Promise<number> {
  const inputs = readInputs(deps);
  if (Either.isLeft(inputs)) {
    deps.log(inputs.left);
    return EXIT_FAIL;
  }
  const previous = readPrevious(deps);
  if (!previous.ok) {
    deps.log(ERROR_STATUS);
    return EXIT_FAIL;
  }
  const uploaded = deps.runCommand(uploadArgv(inputs.right.release, shortSha(deps.env[ENV_SHA])), UPLOAD_TIMEOUT_MS);
  if (!succeeded(uploaded)) {
    deps.log(ERROR_UPLOAD);
    return EXIT_FAIL;
  }
  const next = parseVersionId(uploaded.output);
  if (next === undefined) {
    deps.log(ERROR_NO_VERSION_ID);
    return EXIT_FAIL;
  }
  deps.log(uploadedLine(next));
  return rollOut({ ...inputs.right, deps, options, next, previous: previous.id, report: [] });
}

export function spawnCaptured(argv: readonly string[], timeoutMs: number): CommandResult {
  const [file, ...args] = argv;
  if (file === undefined) return { status: EXIT_FAIL, output: "", timedOut: false };
  const result = spawnSync(file, args, { timeout: timeoutMs, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  process.stdout.write(output);
  const error = result.error;
  return { status: result.status ?? EXIT_FAIL, output, timedOut: error !== undefined && "code" in error && error.code === TIMEOUT_CODE };
}

function realDeps(): Deps {
  return {
    env: Bun.env,
    runCommand: spawnCaptured,
    appendFile: (file, text) => fs.appendFileSync(file, text),
    readFile: (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : undefined),
    wranglerPath: path.join(import.meta.dir, "..", "..", "wrangler.jsonc"),
    fetch: fetchAnswer,
    sleep: (ms) => Bun.sleep(ms),
    log: (line) => console.log(line),
  };
}

if (import.meta.main) {
  process.exit(await run(realDeps()));
}
