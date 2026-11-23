#!/usr/bin/env bun
import crypto from "node:crypto";
import { join } from "node:path";
import { hashPassword } from "better-auth/crypto";
import { Effect, Either, Schedule } from "effect";
import { DEFAULT_SCENARIO, SCENARIO_NAMES } from "../app/lib/constants/fixtures";
import { getScenario, isScenarioName } from "../app/lib/fixtures/scenarios";
import type { Scenario, ScenarioName } from "../app/lib/fixtures/schema";
import { buildScenarioStatements, renderSqlFile } from "../app/lib/fixtures/sql";
import { type FixtureValidationError, SeedError } from "../app/models/errors/fixture";
import { realShell, step, type Shell } from "./lib/shell";
import { EXIT_FAIL } from "./lib/shell-constants";
import {
  D1_BINDING,
  DEFAULT_PREVIEW_SLUG,
  DERIVED_PASSWORD_LENGTH,
  LOCAL_FIXTURE_PASSWORD,
  LOCAL_TARGET_FLAGS,
  MIN_SEED_SECRET_LENGTH,
  PREVIEW_SLUG_PATTERN,
  PREVIEW_TARGET_FLAGS,
  REMOTE_TARGET_FLAGS,
  SEED_BUSY_RETRIES,
  SEED_BUSY_RETRY_DELAY,
  SEED_FILE_NAME,
  SEED_TMP_PREFIX,
  SQLITE_BUSY,
  WRANGLER_COMMAND,
} from "./lib/seed-constants";

export interface Target {
  readonly kind: "local" | "preview" | "remote";
  readonly flags: ReadonlyArray<string>;
  readonly label: string;
}

export type Plan =
  | { readonly kind: "describe"; readonly scenario: ScenarioName }
  | { readonly kind: "print-password"; readonly password: string }
  | { readonly kind: "seed"; readonly target: Target; readonly password: string; readonly scenario: ScenarioName };

const LOCAL: Target = { kind: "local", flags: LOCAL_TARGET_FLAGS, label: "local" };
const PREVIEW: Target = { kind: "preview", flags: PREVIEW_TARGET_FLAGS, label: "preview" };
const PRODUCTION: Target = { kind: "remote", flags: REMOTE_TARGET_FLAGS, label: "production (--remote, forced)" };

const hmac24 = (secret: string, message: string): string =>
  crypto.createHmac("sha256", secret).update(message).digest("base64url").slice(0, DERIVED_PASSWORD_LENGTH);

export const derivePreviewPassword = (secret: string, slug: string): string => hmac24(secret, `preview:${slug}`);

export const deriveProductionPassword = (secret: string): string => hmac24(secret, "production:");

const bad = (message: string): Either.Either<never, string> => Either.left(message);

const readSecret = (env: Record<string, string | undefined>, name: "PREVIEW_SEED_SECRET" | "PRODUCTION_SEED_SECRET"): Either.Either<string, string> => {
  const secret = env[name] ?? "";
  return secret.length >= MIN_SEED_SECRET_LENGTH
    ? Either.right(secret)
    : bad(
        `${name} must be set to at least ${MIN_SEED_SECRET_LENGTH} characters. ` +
          "Preview and production seeds never use the password that is in this repo; they derive one from that secret.",
      );
};

const readFlagValue = (argv: ReadonlyArray<string>, flag: string): string | undefined => {
  const at = argv.indexOf(flag);
  return at < 0 ? undefined : (argv[at + 1] ?? "");
};

const readSlug = (argv: ReadonlyArray<string>): Either.Either<string, string> => {
  const slug = readFlagValue(argv, "--pr");
  if (slug === undefined) return Either.right(DEFAULT_PREVIEW_SLUG);
  return PREVIEW_SLUG_PATTERN.test(slug) ? Either.right(slug) : bad(`--pr needs a slug of letters, digits and dashes, got "${slug}"`);
};

export const readScenario = (argv: ReadonlyArray<string>): Either.Either<ScenarioName, string> => {
  const name = readFlagValue(argv, "--scenario");
  if (name === undefined) return Either.right(DEFAULT_SCENARIO);
  return isScenarioName(name) ? Either.right(name) : bad(`--scenario must be one of ${SCENARIO_NAMES.join(", ")}, got "${name}"`);
};

const productionRefusal = (): string =>
  [
    "Refusing to seed the top-level (production) D1 database.",
    "",
    "Seeding synthetic admin/user/banned fixtures into production creates real,",
    "discoverable accounts with an admin role.",
    "",
    "If you need it (a fresh production database, demo data), re-run with the secret set:",
    "",
    "  PRODUCTION_SEED_SECRET=... bun scripts/seed-preview.ts --remote --force-production",
  ].join("\n");

const planFor = (argv: ReadonlyArray<string>, env: Record<string, string | undefined>, scenario: ScenarioName): Either.Either<Plan, string> => {
  const has = (flag: string) => argv.includes(flag);
  if (has("--describe")) return Either.right({ kind: "describe", scenario });
  if (has("--print-password")) {
    if (!has("--pr")) return bad("--print-password needs --pr <slug>");
    return Either.flatMap(readSecret(env, "PREVIEW_SEED_SECRET"), (secret) =>
      Either.map(readSlug(argv), (slug): Plan => ({ kind: "print-password", password: derivePreviewPassword(secret, slug) })),
    );
  }
  if (has("--preview") && has("--remote")) return bad("Pass either --preview or --remote, not both.");
  if (has("--remote") && !has("--force-production")) return bad(productionRefusal());
  if (has("--remote")) {
    if (has("--pr")) return bad("--pr does not apply to the production seed");
    return Either.map(
      readSecret(env, "PRODUCTION_SEED_SECRET"),
      (secret): Plan => ({ kind: "seed", target: PRODUCTION, password: deriveProductionPassword(secret), scenario }),
    );
  }
  if (has("--preview")) {
    return Either.flatMap(readSecret(env, "PREVIEW_SEED_SECRET"), (secret) =>
      Either.map(readSlug(argv), (slug): Plan => ({ kind: "seed", target: PREVIEW, password: derivePreviewPassword(secret, slug), scenario })),
    );
  }
  if (has("--pr")) return bad("--pr only applies with --preview or --remote --force-production");
  return Either.right({ kind: "seed", target: LOCAL, password: LOCAL_FIXTURE_PASSWORD, scenario });
};

export const parseArgs = (argv: ReadonlyArray<string>, env: Record<string, string | undefined>): Either.Either<Plan, string> =>
  Either.flatMap(readScenario(argv), (scenario) => planFor(argv, env, scenario));

export const buildSeedSql = (scenario: Scenario, passwordHash: string): string => renderSqlFile(buildScenarioStatements(scenario, { passwordHash }));

const loginUsers = (scenario: Scenario) => scenario.users.filter((user) => user.fixtureRole !== undefined);

const userState = (user: Scenario["users"][number]): string => {
  if (user.banned) return `banned (${user.banReason ?? "no reason"})`;
  return user.emailVerified ? "active, email verified" : "active";
};

export const describeMarkdown = (scenario: Scenario): string =>
  [
    "#### Seeded test accounts",
    "",
    "The password is derived per preview from the `PREVIEW_SEED_SECRET` secret. " +
      "A maintainer prints it with `PREVIEW_SEED_SECRET=... bun scripts/seed-preview.ts --print-password --pr <N>`.",
    "",
    "| Email | Role | State |",
    "|-------|------|-------|",
    ...loginUsers(scenario).map((user) => `| \`${user.email}\` | ${user.role} | ${userState(user)} |`),
    "",
    "Seeded data: the accounts above (Better Auth `user` + credential `account` rows); no other tables are seeded yet. " +
      "Every push restores them: rows with a `seed-` id are deleted and inserted again, so changes to these accounts " +
      "do not last, and rows you create yourself survive.",
    "",
  ].join("\n");

const credentialsTable = (scenario: Scenario, target: Target): string => {
  const users = loginUsers(scenario);
  if (users.length === 0) return `\nScenario "${scenario.name}" has no login users, so nobody can sign in until you seed another scenario.\n`;
  const heading =
    target.kind === "local"
      ? `\nSeeded credentials (password for all: ${LOCAL_FIXTURE_PASSWORD}):\n`
      : "\nSeeded accounts (password derived from a seed secret; see docs/ci/pipelines.md):\n";
  const width = Math.max(...users.map((user) => user.email.length));
  const rows = users.map((user) => `  ${user.email.padEnd(width)}  ${user.role.padEnd("admin".length)}  ${user.banned ? "banned" : ""}`);
  return [heading, ...rows, ""].join("\n");
};

const isBusy = (error: SeedError): boolean => error.message.includes(SQLITE_BUSY);

const executeFile = (shell: Shell, target: Target, scenario: ScenarioName, file: string): Effect.Effect<void, SeedError> =>
  Effect.suspend(() =>
    Either.match(step(shell, WRANGLER_COMMAND[0], [...WRANGLER_COMMAND.slice(1), "d1", "execute", D1_BINDING, ...target.flags, "--file", file], shell.cwd), {
      onLeft: (message) => Effect.fail(new SeedError({ scenario, target: target.kind, message })),
      onRight: () => Effect.void,
    }),
  ).pipe(Effect.retry({ times: SEED_BUSY_RETRIES, while: isBusy, schedule: Schedule.spaced(SEED_BUSY_RETRY_DELAY) }));

const runSqlFile = (shell: Shell, target: Target, scenario: ScenarioName, sql: string): Effect.Effect<void, SeedError> =>
  Effect.acquireUseRelease(
    Effect.sync(() => shell.tempDir(SEED_TMP_PREFIX)),
    (dir) => {
      const file = join(dir, SEED_FILE_NAME);
      return Effect.sync(() => shell.write(file, sql)).pipe(Effect.zipRight(executeFile(shell, target, scenario, file)));
    },
    (dir) => Effect.sync(() => shell.remove(dir)),
  );

export const seed = (plan: Extract<Plan, { kind: "seed" }>, shell: Shell): Effect.Effect<Scenario, FixtureValidationError | SeedError> =>
  Effect.gen(function* () {
    const scenario = yield* getScenario(plan.scenario);
    const passwordHash = yield* Effect.tryPromise({
      try: () => hashPassword(plan.password),
      catch: (cause) => new SeedError({ scenario: plan.scenario, target: plan.target.kind, message: "could not hash the fixture password", cause }),
    });
    shell.out(`Seeding ${plan.target.label} D1 (${D1_BINDING} binding) with scenario "${scenario.name}"...`);
    yield* runSqlFile(shell, plan.target, scenario.name, buildSeedSql(scenario, passwordHash));
    shell.out(`✓ Restored ${scenario.users.length} fixture users in ${plan.target.label} D1`);
    shell.out(credentialsTable(scenario, plan.target));
    return scenario;
  });

const runPlan = (plan: Plan, shell: Shell): Effect.Effect<void, FixtureValidationError | SeedError> => {
  switch (plan.kind) {
    case "describe":
      return getScenario(plan.scenario).pipe(Effect.map((scenario) => shell.out(describeMarkdown(scenario))));
    case "print-password":
      return Effect.sync(() => shell.out(plan.password));
    case "seed":
      return Effect.asVoid(seed(plan, shell));
  }
};

export const describeFailure = (error: string | FixtureValidationError | SeedError): string => {
  if (typeof error === "string") return error;
  if (error._tag === "SeedError") return `Failed to seed the ${error.target} D1 with scenario "${error.scenario}". Nothing was written.\n${error.message}`;
  return `Scenario "${error.scenario}" is not valid${error.fixture ? ` (fixture ${error.fixture})` : ""}. Nothing was written.\n${error.message}`;
};

if (import.meta.main) {
  const shell = realShell();
  const plan = parseArgs(process.argv.slice(2), process.env);
  const program: Effect.Effect<void, string | FixtureValidationError | SeedError> = Either.isLeft(plan) ? Effect.fail(plan.left) : runPlan(plan.right, shell);
  void Effect.runPromise(
    program.pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          shell.err(`✗ ${describeFailure(error)}`);
          process.exitCode = EXIT_FAIL;
        }),
      ),
      Effect.catchAllDefect((defect) =>
        Effect.sync(() => {
          shell.err(`✗ ${String(defect)}`);
          process.exitCode = EXIT_FAIL;
        }),
      ),
    ),
  );
}
