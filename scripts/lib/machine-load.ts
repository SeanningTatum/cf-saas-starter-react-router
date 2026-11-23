import { Data, Effect } from "effect";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AnyStateMachine } from "xstate";
import type { Repo } from "../lint/types";
import { FIX, MACHINE_FILE, MACHINE_ROOTS, MESSAGE, TEST_DIR } from "./machine-constants";

export class MachineLoadError extends Data.TaggedError("MachineLoadError")<{
  readonly file: string;
  readonly cause: unknown;
}> {}

export interface LoadedMachine {
  readonly file: string;
  readonly exportName: string;
  readonly machine: AnyStateMachine;
}

export const isMachine = (value: unknown): value is AnyStateMachine =>
  typeof value === "object" && value !== null && "root" in value && "getStateNodeById" in value && "implementations" in value;

export function machinesIn(file: string, module: Record<string, unknown>): LoadedMachine[] {
  const seen = new Set<AnyStateMachine>();
  return Object.entries(module).flatMap(([exportName, value]) => {
    if (!isMachine(value) || seen.has(value)) return [];
    seen.add(value);
    return [{ file, exportName, machine: value }];
  });
}

export const machineFiles = (repo: Pick<Repo, "files">): string[] =>
  MACHINE_ROOTS.flatMap((dir) => repo.files(dir)).filter((path) => MACHINE_FILE.test(path) && !path.includes(TEST_DIR));

export const loadMachines = (root: string, file: string): Effect.Effect<LoadedMachine[], MachineLoadError> =>
  Effect.tryPromise({
    try: (): Promise<Record<string, unknown>> => import(pathToFileURL(resolve(root, file)).href),
    catch: (cause) => new MachineLoadError({ file, cause }),
  }).pipe(Effect.map((module) => machinesIn(file, module)));

export const loadFailure = (error: MachineLoadError): { readonly message: string; readonly fix: string } => ({
  message: `${MESSAGE.load} ${error.cause instanceof Error ? error.cause.message : String(error.cause)}`,
  fix: FIX.load.replace("<file>", error.file),
});
