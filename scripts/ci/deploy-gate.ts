#!/usr/bin/env bun
// Deploy gate (CI-only). Answers one question for a workflow: is this repo set
// up for this pipeline? A repo that is not set up ends as skipped with a
// one-line notice, never as failed.
//
// Usage:
//   bun scripts/ci/deploy-gate.ts ready <production|staging|preview|preview-cleanup>
//   bun scripts/ci/deploy-gate.ts use-d1
//   bun scripts/ci/deploy-gate.ts project-name   (prints the Worker name from wrangler.jsonc)
//
// `ready` reads facts from env. The workflow sets each one to "true" or
// "false" from `vars` and `secrets`, so no secret value ever reaches this
// script:
//   production HAS_ACCOUNT_ID, D1_DATABASE_ID (optional); staging also STAGING_TOKEN_AT_REPO_LEVEL
//   preview          HAS_ACCOUNT_ID, HAS_TOKEN, HAS_SEED_SECRET
//   preview-cleanup  HAS_ACCOUNT_ID, HAS_TOKEN
//   any target       PROD_TOKEN_AT_REPO_LEVEL (adds a warning)
// It prints `ready` or one `::notice::` line, appends `ready=true|false` to
// $GITHUB_OUTPUT and exits 0 either way. Exit 2 is bad usage, exit 1 is a
// wrangler.jsonc it cannot read.
//
// `use-d1` rewrites the top-level DATABASE binding's database_id in the CI
// checkout's wrangler.jsonc from D1_DATABASE_ID. The patched file is never
// committed.
import { Either, Schema } from "effect";
import fs from "node:fs";
import path from "node:path";
import { stripJsonc } from "../lib/wrangler-config";

export type Target = "production" | "staging" | "preview" | "preview-cleanup";
export const TARGETS: readonly Target[] = ["production", "staging", "preview", "preview-cleanup"];

const WORKFLOW_NAMES: Record<Target, string> = {
  production: "Deploy Production",
  staging: "Deploy Staging",
  preview: "Preview Deploy",
  "preview-cleanup": "Preview Cleanup",
};

const DOC = "docs/ci/pipelines.md";
const REPO_TOKEN_WARNING =
  "a repo-level CLOUDFLARE_API_TOKEN secret is readable by pull-request jobs; move it to the production environment and delete the repo-level one";
const STAGING_REPO_TOKEN =
  "a repo-level CLOUDFLARE_STAGING_API_TOKEN secret is readable by every branch's workflows; delete it and set it on the protected staging environment only";
const PATCH_HEADER = "// Patched by scripts/ci/deploy-gate.ts — production D1 id (CI checkout only, never committed).";

export interface Facts {
  hasAccountId: boolean;
  hasToken: boolean;
  hasSeedSecret: boolean;
  prodTokenAtRepoLevel: boolean;
  /** The DATABASE id committed at the top level of wrangler.jsonc, if any. */
  committedD1Id: string | undefined;
  /** The CLOUDFLARE_D1_DATABASE_ID repo variable, "" when unset. */
  d1Override: string;
  hasStagingUrl: boolean;
  stagingD1Id: string | undefined;
  stagingTokenAtRepoLevel: boolean;
}

export interface Decision {
  ready: boolean;
  reason: string;
  warnings: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A UUID that is not all zeros (the zero UUID is the committed placeholder). */
export function isRealD1Id(id: string | undefined): boolean {
  return id !== undefined && UUID.test(id) && /[1-9a-f]/i.test(id);
}

export function decide(target: Target, facts: Facts): Decision {
  const warnings = facts.prodTokenAtRepoLevel ? [REPO_TOKEN_WARNING] : [];
  const missing = firstMissing(target, facts);
  return missing ? { ready: false, reason: missing, warnings } : { ready: true, reason: "ready", warnings };
}

function firstMissing(target: Target, facts: Facts): string | undefined {
  const accountVariable =
    target === "production" || target === "staging"
      ? "the CLOUDFLARE_ACCOUNT_ID variable is not set"
      : "neither the CLOUDFLARE_PREVIEW_ACCOUNT_ID nor the CLOUDFLARE_ACCOUNT_ID variable is set";
  if (!facts.hasAccountId) return accountVariable;
  if (target === "staging") return stagingMissing(facts);

  if (target === "production") {
    const hasRealId = isRealD1Id(facts.committedD1Id) || isRealD1Id(facts.d1Override);
    return hasRealId ? undefined : 'wrangler.jsonc still has the placeholder D1 id; run "bun run setup" or set the CLOUDFLARE_D1_DATABASE_ID variable';
  }
  if (!facts.hasToken) return "the CLOUDFLARE_PREVIEW_API_TOKEN secret is not set";
  if (target === "preview" && !facts.hasSeedSecret) {
    return "the PREVIEW_SEED_SECRET secret is not set";
  }
  return undefined;
}

function stagingMissing(facts: Facts): string | undefined {
  if (facts.stagingTokenAtRepoLevel) return STAGING_REPO_TOKEN;
  if (!isRealD1Id(facts.stagingD1Id)) return 'wrangler.jsonc has no real staging D1 id under env.staging; run "bun run setup"';
  return facts.hasStagingUrl ? undefined : "the STAGING_URL variable is not set";
}

// --- wrangler.jsonc ---------------------------------------------------------

const D1Entry = Schema.Struct({
  binding: Schema.String,
  database_id: Schema.optional(Schema.String),
});
const WranglerShape = Schema.Struct({
  d1_databases: Schema.optional(Schema.Array(D1Entry)),
});
const StagingShape = Schema.Struct({
  env: Schema.optional(Schema.Struct({ staging: Schema.optional(WranglerShape) })),
});
const RawJson = Schema.parseJson(Schema.Unknown);

/** wrangler.jsonc keeps its comments on whole lines; strip those and parse. */
function parseJsonc(text: string): Either.Either<unknown, string> {
  return Either.mapLeft(Schema.decodeUnknownEither(RawJson)(stripJsonc(text)), () => "wrangler.jsonc is not valid JSON");
}

/** The Worker's `name` from wrangler.jsonc. */
export function readProjectName(text: string): Either.Either<string, string> {
  return Either.flatMap(parseJsonc(text), (raw) =>
    Either.mapLeft(Schema.decodeUnknownEither(Schema.Struct({ name: Schema.NonEmptyString }))(raw), () => "wrangler.jsonc has no name"),
  ).pipe(Either.map((found) => found.name));
}

interface Found {
  index: number;
  id: string | undefined;
}

function findTopLevelDatabase(raw: unknown): Either.Either<Found, string> {
  const shape = Schema.decodeUnknownEither(WranglerShape)(raw);
  if (Either.isLeft(shape)) return Either.left("wrangler.jsonc has a malformed d1_databases list");
  const entries = shape.right.d1_databases ?? [];
  const index = entries.findIndex((d) => d.binding === "DATABASE");
  const entry = entries[index];
  return entry === undefined
    ? Either.left('wrangler.jsonc has no top-level d1_databases entry with binding "DATABASE"')
    : Either.right({ index, id: entry.database_id });
}

/** The id of the top-level DATABASE binding, or an error when the file is unreadable. */
export function readCommittedD1Id(text: string): Either.Either<string | undefined, string> {
  return Either.flatMap(parseJsonc(text), (raw) => Either.map(findTopLevelDatabase(raw), (found) => found.id));
}

export function readStagingD1Id(text: string): Either.Either<string | undefined, string> {
  return Either.flatMap(parseJsonc(text), (raw) =>
    Either.match(Schema.decodeUnknownEither(StagingShape)(raw), {
      onLeft: () => Either.left("wrangler.jsonc has a malformed env.staging block"),
      onRight: (shape) => Either.right(shape.env?.staging?.d1_databases?.find((d) => d.binding === "DATABASE")?.database_id),
    }),
  );
}

/** wrangler.jsonc text with the top-level DATABASE binding pointed at `id`. */
export function withProductionD1(text: string, id: string): Either.Either<string, string> {
  if (!isRealD1Id(id)) {
    return Either.left("CLOUDFLARE_D1_DATABASE_ID must be a D1 database UUID that is not all zeros");
  }
  return Either.flatMap(parseJsonc(text), (raw) =>
    Either.map(findTopLevelDatabase(raw), ({ index }) => {
      const config = raw as { d1_databases: { database_id?: string }[] };
      const target = config.d1_databases[index];
      if (target) target.database_id = id;
      return `${PATCH_HEADER}\n${JSON.stringify(config, null, 2)}\n`;
    }),
  );
}

// --- CLI --------------------------------------------------------------------

export interface Deps {
  env: Record<string, string | undefined>;
  readFile: (file: string) => string | undefined;
  writeFile: (file: string, text: string) => void;
  appendFile: (file: string, text: string) => void;
  log: (line: string) => void;
  wranglerPath: string;
}

const isTrue = (value: string | undefined) => value === "true";

export function factsFromEnv(env: Deps["env"], committedD1Id: string | undefined, stagingD1Id?: string): Facts {
  return {
    hasAccountId: isTrue(env.HAS_ACCOUNT_ID),
    hasToken: isTrue(env.HAS_TOKEN),
    hasSeedSecret: isTrue(env.HAS_SEED_SECRET),
    prodTokenAtRepoLevel: isTrue(env.PROD_TOKEN_AT_REPO_LEVEL),
    committedD1Id,
    d1Override: (env.D1_DATABASE_ID ?? "").trim(),
    hasStagingUrl: isTrue(env.HAS_STAGING_URL),
    stagingTokenAtRepoLevel: isTrue(env.STAGING_TOKEN_AT_REPO_LEVEL),
    stagingD1Id,
  };
}

function usage(deps: Deps, message: string): number {
  deps.log(`::error::${message}`);
  deps.log(`usage: deploy-gate.ts ready <${TARGETS.join("|")}> | use-d1 | project-name`);
  return 2;
}

function report(target: Target, decision: Decision, deps: Deps): void {
  const name = WORKFLOW_NAMES[target];
  deps.log(decision.ready ? "ready" : `::notice::${name} skipped: ${decision.reason}. See ${DOC}`);
  for (const warning of decision.warnings) deps.log(`::warning::${warning}`);
  const output = deps.env.GITHUB_OUTPUT;
  if (output) deps.appendFile(output, `ready=${decision.ready}\n`);
}

/** Read wrangler.jsonc and apply `step` to its text; log `::error::` and return 1 on failure. */
function withWrangler<T>(deps: Deps, step: (text: string) => Either.Either<T, string>, done: (value: T) => void): number {
  const text = deps.readFile(deps.wranglerPath);
  const result = text === undefined ? Either.left(`cannot read ${deps.wranglerPath}`) : step(text);
  if (Either.isLeft(result)) {
    deps.log(`::error::${result.left}`);
    return 1;
  }
  done(result.right);
  return 0;
}

function ready(target: Target, deps: Deps): number {
  const ids = (text: string) => Either.all({ committed: readCommittedD1Id(text), staging: readStagingD1Id(text) });
  return withWrangler(deps, ids, ({ committed, staging }) => report(target, decide(target, factsFromEnv(deps.env, committed, staging)), deps));
}

function useD1(deps: Deps): number {
  return withWrangler(
    deps,
    (text) => withProductionD1(text, (deps.env.D1_DATABASE_ID ?? "").trim()),
    (patched) => {
      deps.writeFile(deps.wranglerPath, patched);
      deps.log("wrangler.jsonc: top-level DATABASE now uses the CLOUDFLARE_D1_DATABASE_ID variable");
    },
  );
}

function projectName(deps: Deps): number {
  return withWrangler(deps, readProjectName, (name) => deps.log(name));
}

export function run(argv: string[], deps: Deps): number {
  const [verb, target] = argv;
  if (verb === "use-d1" && argv.length === 1) return useD1(deps);
  if (verb === "project-name" && argv.length === 1) return projectName(deps);
  if (verb === "ready" && argv.length === 2) {
    const known = TARGETS.find((t) => t === target);
    return known ? ready(known, deps) : usage(deps, `unknown target "${target}"`);
  }
  return usage(deps, "bad arguments");
}

function realDeps(): Deps {
  return {
    env: Bun.env,
    readFile: (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : undefined),
    writeFile: (file, text) => fs.writeFileSync(file, text),
    appendFile: (file, text) => fs.appendFileSync(file, text),
    log: (line) => console.log(line),
    wranglerPath: path.join(import.meta.dir, "..", "..", "wrangler.jsonc"),
  };
}

if (import.meta.main) {
  process.exit(run(process.argv.slice(2), realDeps()));
}
