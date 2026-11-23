#!/usr/bin/env bun
import { Effect } from "effect";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { diskRepo } from "./lint/repo";
import type { Repo } from "./lint/types";
import { checkMachine } from "./lib/machine-check";
import { CHECK, CHECK_USAGE, EXIT, FIX, MESSAGE, NOTHING_TO_CHECK } from "./lib/machine-constants";
import { type LoadedMachine, type MachineLoadError, loadFailure, loadMachines, machineFiles } from "./lib/machine-load";

export interface Deps {
  repo: Pick<Repo, "files">;
  load(file: string): Effect.Effect<LoadedMachine[], MachineLoadError>;
  out(line: string): void;
  err(line: string): void;
}

const line = (file: string, check: string, where: string, message: string, fix: string): string =>
  `${file} ${check}: ${where}${message}. Do this instead: ${fix}.`;

const findingsFor = (deps: Deps, file: string): Effect.Effect<{ machines: number; lines: string[] }> =>
  deps.load(file).pipe(
    Effect.map((machines) => ({
      machines: machines.length,
      lines:
        machines.length === 0
          ? [line(file, CHECK.noMachine, "", MESSAGE.noMachine, FIX.noMachine)]
          : machines.flatMap(({ machine }) =>
              checkMachine(machine).map((found) => line(file, found.check, `machine "${machine.id}", state "${found.state}": `, found.message, found.fix)),
            ),
    })),
    Effect.catchTag("MachineLoadError", (error) => {
      const { message, fix } = loadFailure(error);
      return Effect.succeed({ machines: 0, lines: [line(file, CHECK.load, "", message, fix)] });
    }),
  );

export function run(argv: readonly string[], deps: Deps): Effect.Effect<number> {
  if (argv.some((arg) => arg.startsWith("-"))) {
    deps.err(CHECK_USAGE);
    return Effect.succeed(EXIT.usage);
  }
  const files = argv.length > 0 ? [...argv] : machineFiles(deps.repo);
  if (files.length === 0) {
    deps.out(NOTHING_TO_CHECK);
    return Effect.succeed(EXIT.clean);
  }
  return Effect.forEach(files, (file) => findingsFor(deps, file)).pipe(
    Effect.map((results) => {
      const lines = results.flatMap((result) => result.lines);
      const machines = results.reduce((sum, result) => sum + result.machines, 0);
      for (const found of lines) deps.out(found);
      deps.out(`check-machines: ${files.length} file(s), ${machines} machine(s), ${lines.length} finding(s)`);
      return lines.length === 0 ? EXIT.clean : EXIT.findings;
    }),
  );
}

if (import.meta.main) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const code = await Effect.runPromise(
    run(process.argv.slice(2), {
      repo: diskRepo(root),
      load: (file) => loadMachines(root, file),
      out: (text) => console.log(text),
      err: (text) => console.error(text),
    }),
  );
  process.exit(code);
}
