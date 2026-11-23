import { Effect } from "effect";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AnyStateMachine } from "xstate";
import { type Deps, run } from "../check-machines";
import { CHECK_USAGE, FIX, NOTHING_TO_CHECK } from "../lib/machine-constants";
import { type LoadedMachine, loadMachines, MachineLoadError } from "../lib/machine-load";
import { memoryRepo } from "../lint/repo";
import { deadEndMachine, soundMachine, unreachableMachine } from "../lib/__tests__/fixtures/machines";

const ROOT = resolve(__dirname, "..", "..");

type Load = Deps["load"];

const loaded = (file: string, ...machines: AnyStateMachine[]): LoadedMachine[] => machines.map((machine) => ({ file, exportName: machine.id, machine }));

function harness(load: Load, repoFiles: readonly string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const deps: Deps = {
    repo: memoryRepo(Object.fromEntries(repoFiles.map((file) => [file, ""]))),
    load: (file) => {
      asked.push(file);
      return load(file);
    },
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  };
  const exec = (argv: readonly string[]) => Effect.runPromise(run(argv, deps));
  return { out, err, asked, exec };
}

const fromTable =
  (table: Record<string, AnyStateMachine[]>): Load =>
  (file) =>
    Effect.succeed(loaded(file, ...(table[file] ?? [])));

describe("check-machines run", () => {
  it("prints usage and exits 2 on any flag, even beside a file, so a typo never passes as a clean run", async () => {
    const { out, err, asked, exec } = harness(fromTable({}));
    expect(await exec(["--help"])).toBe(2);
    expect(await exec(["app/a.machine.ts", "-x"])).toBe(2);
    expect(err).toEqual([CHECK_USAGE, CHECK_USAGE]);
    expect(out).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("says there is nothing to check and exits 0 when no machine file exists, so a fresh fork passes the gate", async () => {
    const { out, exec } = harness(fromTable({}), ["app/routes/home.tsx"]);
    expect(await exec([])).toBe(0);
    expect(out).toEqual([NOTHING_TO_CHECK]);
  });

  it("walks the repo's machine files when given none and exits 0 on a sound machine, so the default run covers every machine", async () => {
    const { out, asked, exec } = harness(fromTable({ "app/a.machine.ts": [soundMachine] }), ["app/a.machine.ts", "app/b.ts"]);
    expect(await exec([])).toBe(0);
    expect(asked).toEqual(["app/a.machine.ts"]);
    expect(out).toEqual(["check-machines: 1 file(s), 1 machine(s), 0 finding(s)"]);
  });

  it("prints one house-shaped line per finding and exits 1, checking only the files named, so an author sees what to fix in each machine", async () => {
    const { out, asked, exec } = harness(fromTable({ "app/bad.machine.ts": [unreachableMachine, deadEndMachine] }), ["app/other.machine.ts"]);
    expect(await exec(["app/bad.machine.ts"])).toBe(1);
    expect(asked).toEqual(["app/bad.machine.ts"]);
    expect(out).toEqual([
      'app/bad.machine.ts machines/unreachable: machine "unreachable", state "orphan": no transition reaches it from the initial state. Do this instead: add a transition that targets it, or delete the state.',
      `app/bad.machine.ts machines/dead-end: machine "deadEnd", state "stuck": once entered, no path leads back to the initial state or to a final state, and it is not marked final. Do this instead: ${FIX.deadEnd}.`,
      "check-machines: 1 file(s), 2 machine(s), 2 finding(s)",
    ]);
  });

  it("reports a machine file that exports no machine, so a file named .machine.ts cannot slip past every check", async () => {
    const { out, exec } = harness(fromTable({}));
    expect(await exec(["app/empty.machine.ts"])).toBe(1);
    expect(out).toEqual([
      `app/empty.machine.ts machines/no-machine: the file exports no XState machine. Do this instead: ${FIX.noMachine}.`,
      "check-machines: 1 file(s), 0 machine(s), 1 finding(s)",
    ]);
  });

  it("reports a file that fails to load with its cause and still checks the rest, so one broken import does not hide the other machines", async () => {
    const load: Load = (file) =>
      file === "app/broken.machine.ts"
        ? Effect.fail(new MachineLoadError({ file, cause: new Error("Cannot find module './gone'") }))
        : fromTable({ "app/a.machine.ts": [soundMachine] })(file);
    const { out, exec } = harness(load);
    expect(await exec(["app/broken.machine.ts", "app/a.machine.ts"])).toBe(1);
    expect(out).toEqual([
      "app/broken.machine.ts machines/load: the file does not load: Cannot find module './gone'. Do this instead: run `bun app/broken.machine.ts` to see why, and fix the import.",
      "check-machines: 2 file(s), 1 machine(s), 1 finding(s)",
    ]);
  });

  it("prints a cause that is not an Error as text, so a thrown string still reaches the finding", async () => {
    const { out, exec } = harness((file) => Effect.fail(new MachineLoadError({ file, cause: "boom" })));
    expect(await exec(["app/x.machine.ts"])).toBe(1);
    expect(out[0]).toContain("machines/load: the file does not load: boom.");
  });

  it("checks a real module end to end, so the import and the checks agree on what a machine is", async () => {
    const file = "scripts/lib/__tests__/fixtures/machines.ts";
    const out: string[] = [];
    const code = await Effect.runPromise(
      run([file], { repo: memoryRepo({}), load: (name) => loadMachines(ROOT, name), out: (line) => out.push(line), err: () => undefined }),
    );
    expect(code).toBe(1);
    expect(out).toContain(
      `${file} machines/unreachable: machine "unreachable", state "orphan": no transition reaches it from the initial state. Do this instead: ${FIX.unreachable}.`,
    );
    expect(out.some((line) => line.includes('machine "sound"'))).toBe(false);
  });
});
