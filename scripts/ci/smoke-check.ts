#!/usr/bin/env bun
import { Either, Schema } from "effect";
import fs from "node:fs";
import { HEALTH_DOWN, HEALTH_UP, HEALTHZ_PATH } from "../../app/lib/constants/health";
import {
  ENV_SUMMARY,
  ERROR_BAD_URL,
  ERROR_BAD_VERSION,
  ERROR_BAD_WORKER,
  ERROR_HALF_PIN,
  EXIT_FAIL,
  EXIT_OK,
  EXIT_USAGE,
  FLAG_RELEASE,
  FLAG_URL,
  FLAG_VERSION_ID,
  FLAG_WORKER,
  HEALTHY_STATUS,
  LOCAL_HOSTS,
  LOCAL_PROTOCOL,
  REASON_DOWN,
  REASON_NOT_JSON,
  REASON_NO_ANSWER,
  ROOT_PATH,
  SECURE_PROTOCOL,
  SMOKE_ATTEMPTS,
  SMOKE_DELAY_MS,
  SMOKE_TIMEOUT_MS,
  USAGE,
  VALUE_FLAGS,
  VERSION_ID_RULE,
  VERSION_OVERRIDES_HEADER,
  WORKER_NAME_RULE,
  attemptLine,
  failLine,
  passLine,
  reasonRelease,
  reasonStatus,
  summaryLine,
} from "../lib/smoke-check-constants";

export interface HttpAnswer {
  readonly status: number;
  readonly body: string;
}

export interface Pin {
  readonly worker: string;
  readonly versionId: string;
}

export interface SmokeTarget {
  readonly origin: string;
  readonly release?: string;
  readonly pin?: Pin;
}

export type Verdict = { readonly ok: true; readonly release: string } | { readonly ok: false; readonly reason: string };

export interface SmokeOptions {
  readonly attempts: number;
  readonly delayMs: number;
  readonly timeoutMs: number;
}

export interface SmokeDeps {
  readonly fetch: (url: string, headers: Readonly<Record<string, string>>, timeoutMs: number) => Promise<HttpAnswer | undefined>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (line: string) => void;
}

export const DEFAULT_OPTIONS: SmokeOptions = {
  attempts: SMOKE_ATTEMPTS,
  delayMs: SMOKE_DELAY_MS,
  timeoutMs: SMOKE_TIMEOUT_MS,
};

const HealthBody = Schema.parseJson(Schema.Struct({ status: Schema.Literal(HEALTH_UP, HEALTH_DOWN), release: Schema.String }));
const decodeBody = Schema.decodeUnknownEither(HealthBody);

const isAllowedOrigin = (url: URL): boolean => {
  const secure = url.protocol === SECURE_PROTOCOL;
  const local = url.protocol === LOCAL_PROTOCOL && LOCAL_HOSTS.has(url.hostname);
  const bare = url.pathname === ROOT_PATH && url.search === "" && url.hash === "";
  return (secure || local) && bare && url.username === "" && url.password === "";
};

export function parseOrigin(raw: string): Either.Either<string, string> {
  if (!URL.canParse(raw)) return Either.left(ERROR_BAD_URL);
  const url = new URL(raw);
  return isAllowedOrigin(url) ? Either.right(url.origin) : Either.left(ERROR_BAD_URL);
}

export function parsePin(worker: string | undefined, versionId: string | undefined): Either.Either<Pin | undefined, string> {
  if (worker === undefined && versionId === undefined) return Either.right(undefined);
  if (worker === undefined || versionId === undefined) return Either.left(ERROR_HALF_PIN);
  if (!WORKER_NAME_RULE.test(worker)) return Either.left(ERROR_BAD_WORKER);
  if (!VERSION_ID_RULE.test(versionId)) return Either.left(ERROR_BAD_VERSION);
  return Either.right({ worker, versionId });
}

export const healthUrl = (origin: string): string => `${origin}${HEALTHZ_PATH}`;

export const requestHeaders = (pin: Pin | undefined): Readonly<Record<string, string>> =>
  pin ? { [VERSION_OVERRIDES_HEADER]: `${pin.worker}="${pin.versionId}"` } : {};

export function judge(answer: HttpAnswer | undefined, expectedRelease: string | undefined): Verdict {
  if (answer === undefined) return { ok: false, reason: REASON_NO_ANSWER };
  const body = decodeBody(answer.body);
  if (answer.status !== HEALTHY_STATUS) {
    const down = Either.isRight(body) && body.right.status === HEALTH_DOWN;
    return { ok: false, reason: down ? REASON_DOWN : reasonStatus(answer.status) };
  }
  if (Either.isLeft(body)) return { ok: false, reason: REASON_NOT_JSON };
  if (body.right.status !== HEALTH_UP) return { ok: false, reason: REASON_DOWN };
  if (expectedRelease !== undefined && body.right.release !== expectedRelease) {
    return { ok: false, reason: reasonRelease(expectedRelease, body.right.release) };
  }
  return { ok: true, release: body.right.release };
}

export async function smokeCheck(target: SmokeTarget, deps: SmokeDeps, options: SmokeOptions = DEFAULT_OPTIONS): Promise<Verdict> {
  const url = healthUrl(target.origin);
  const headers = requestHeaders(target.pin);
  let verdict: Verdict = { ok: false, reason: REASON_NO_ANSWER };
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    verdict = judge(await deps.fetch(url, headers, options.timeoutMs), target.release);
    if (verdict.ok) {
      deps.log(passLine(url, verdict.release));
      return verdict;
    }
    deps.log(attemptLine(attempt, options.attempts, verdict.reason));
    if (attempt < options.attempts) await deps.sleep(options.delayMs);
  }
  if (!verdict.ok) deps.log(failLine(url, options.attempts, options.delayMs, verdict.reason));
  return verdict;
}

export function parseArgs(argv: readonly string[]): Either.Either<SmokeTarget, string> {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] ?? "";
    const value = argv[i + 1];
    if (!VALUE_FLAGS.has(flag) || value === undefined || value.startsWith("--")) return Either.left(USAGE);
    values.set(flag, value);
  }
  const rawUrl = values.get(FLAG_URL);
  if (rawUrl === undefined) return Either.left(USAGE);
  return Either.gen(function* () {
    const origin = yield* parseOrigin(rawUrl);
    const pin = yield* parsePin(values.get(FLAG_WORKER), values.get(FLAG_VERSION_ID));
    const release = values.get(FLAG_RELEASE);
    return { origin, ...(release ? { release } : {}), ...(pin ? { pin } : {}) };
  });
}

export interface CliDeps extends SmokeDeps {
  readonly env: Record<string, string | undefined>;
  readonly appendFile: (file: string, text: string) => void;
}

export async function run(argv: readonly string[], deps: CliDeps, options: SmokeOptions = DEFAULT_OPTIONS): Promise<number> {
  const target = parseArgs(argv);
  if (Either.isLeft(target)) {
    deps.log(`::error::${target.left}`);
    return EXIT_USAGE;
  }
  const verdict = await smokeCheck(target.right, deps, options);
  const summary = deps.env[ENV_SUMMARY];
  const url = healthUrl(target.right.origin);
  if (summary) deps.appendFile(summary, `${summaryLine(url, verdict.ok ? passLine(url, verdict.release) : verdict.reason)}\n`);
  return verdict.ok ? EXIT_OK : EXIT_FAIL;
}

export const fetchAnswer: SmokeDeps["fetch"] = (url, headers, timeoutMs) =>
  fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) })
    .then((response) => response.text().then((body): HttpAnswer => ({ status: response.status, body })))
    .then(
      (answer): HttpAnswer | undefined => answer,
      () => undefined,
    );

function realDeps(): CliDeps {
  return {
    env: Bun.env,
    fetch: fetchAnswer,
    sleep: (ms) => Bun.sleep(ms),
    log: (line) => console.log(line),
    appendFile: (file, text) => fs.appendFileSync(file, text),
  };
}

if (import.meta.main) {
  process.exit(await run(process.argv.slice(2), realDeps()));
}
