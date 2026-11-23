#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Effect, Either } from "effect";
import type { ScenarioName } from "../app/lib/fixtures/schema";
import { DevServerRunningError, SeedError } from "../app/models/errors/fixture";
import { BUN_RUN_MIGRATE, LOCAL_STATE_DIR, LSOF_BIN, PID_PATTERN, LSOF_NO_HOLDER_CODE, SEED_SCRIPT, WIPED_STATE_DIRS } from "./lib/db-reset-constants";
import { realShell, step, type Shell } from "./lib/shell";
import { BUN_BIN, EXIT_FAIL, EXIT_OK } from "./lib/shell-constants";
import { readScenario } from "./seed-preview";

const pidsIn = (stdout: string): ReadonlyArray<number> =>
  stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => PID_PATTERN.test(line))
    .map(Number);

export const holdersOf = (shell: Shell, stateDir: string): Either.Either<ReadonlyArray<number>, string> => {
  const result = shell.run(LSOF_BIN, ["-t", "+D", stateDir], shell.cwd);
  if (result.code === EXIT_OK) return Either.right(pidsIn(result.stdout));
  if (result.code === LSOF_NO_HOLDER_CODE && result.stdout.trim() === "" && result.stderr.trim() === "") return Either.right([]);
  return Either.left(
    `\`${LSOF_BIN}\` could not check whether a dev server holds ${stateDir} (${result.stderr.trim() || `exit ${result.code}`}). Stop the dev server, then delete that folder by hand.`,
  );
};

const runStep = (shell: Shell, scenario: ScenarioName, args: ReadonlyArray<string>): Effect.Effect<void, SeedError> =>
  Either.match(step(shell, BUN_BIN, [...args], shell.cwd), {
    onLeft: (message) => Effect.fail(new SeedError({ scenario, target: "local", message })),
    onRight: (result) => Effect.sync(() => shell.out(result.stdout.trimEnd())),
  });

export const reset = (
  scenario: ScenarioName,
  shell: Shell,
  exists: (path: string) => boolean = existsSync,
): Effect.Effect<void, DevServerRunningError | SeedError> =>
  Effect.gen(function* () {
    const stateDir = join(shell.cwd, LOCAL_STATE_DIR);
    const local = (message: string, cause?: unknown) => new SeedError({ scenario, target: "local", message, cause });
    const pids = exists(stateDir) ? yield* Either.mapLeft(holdersOf(shell, stateDir), (message) => local(message)) : [];
    if (pids.length > 0) return yield* Effect.fail(new DevServerRunningError({ pids, stateDir }));
    yield* Effect.try({
      try: () => {
        for (const dir of WIPED_STATE_DIRS) shell.remove(join(stateDir, dir));
      },
      catch: (cause) => local(`could not delete the local state in ${stateDir}`, cause),
    });
    shell.out(`Wiped the local D1 and R2 state in ${stateDir}.`);
    yield* runStep(shell, scenario, BUN_RUN_MIGRATE);
    yield* runStep(shell, scenario, [SEED_SCRIPT, "--scenario", scenario]);
  });

export const describeResetFailure = (error: string | DevServerRunningError | SeedError): string => {
  if (typeof error === "string") return error;
  if (error._tag === "DevServerRunningError") {
    return `Stop the dev server first: process ${error.pids.join(", ")} holds ${error.stateDir}. Nothing was deleted.`;
  }
  return `The reset stopped. Run \`bun run db:prepare\` once the cause is fixed. Run \`bun run db:prepare\` once the cause is fixed.\n${error.message}`;
};

if (import.meta.main) {
  const shell = realShell();
  const scenario = readScenario(process.argv.slice(2));
  const program: Effect.Effect<void, string | DevServerRunningError | SeedError> = Either.isLeft(scenario)
    ? Effect.fail(scenario.left)
    : reset(scenario.right, shell);
  void Effect.runPromise(
    program.pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          shell.err(`✗ ${describeResetFailure(error)}`);
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
