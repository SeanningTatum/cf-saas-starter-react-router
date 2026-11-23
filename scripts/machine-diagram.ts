#!/usr/bin/env bun
import { Effect } from "effect";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIAGRAM_USAGE, EXIT, FIX, MESSAGE } from "./lib/machine-constants";
import { type LoadedMachine, type MachineLoadError, loadFailure, loadMachines } from "./lib/machine-load";
import { toMermaidBlock } from "./lib/machine-mermaid";

export interface Deps {
  load(file: string): Effect.Effect<LoadedMachine[], MachineLoadError>;
  out(line: string): void;
  err(line: string): void;
}

export function run(argv: readonly string[], deps: Deps): Effect.Effect<number> {
  const [file, ...rest] = argv;
  if (file === undefined || rest.length > 0 || file.startsWith("-")) {
    deps.err(DIAGRAM_USAGE);
    return Effect.succeed(EXIT.usage);
  }
  return deps.load(file).pipe(
    Effect.map((machines) => {
      if (machines.length === 0) {
        deps.err(`${file}: ${MESSAGE.noMachine}. Do this instead: ${FIX.noMachine}.`);
        return EXIT.findings;
      }
      machines.forEach(({ machine }, index) => {
        if (index > 0) deps.out("");
        for (const text of toMermaidBlock(machine)) deps.out(text);
      });
      return EXIT.clean;
    }),
    Effect.catchTag("MachineLoadError", (error) => {
      const { message, fix } = loadFailure(error);
      deps.err(`${file}: ${message}. Do this instead: ${fix}.`);
      return Effect.succeed(EXIT.findings);
    }),
  );
}

if (import.meta.main) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const code = await Effect.runPromise(
    run(process.argv.slice(2), {
      load: (file) => loadMachines(root, file),
      out: (text) => console.log(text),
      err: (text) => console.error(text),
    }),
  );
  process.exit(code);
}
