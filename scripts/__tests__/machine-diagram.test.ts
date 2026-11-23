import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { type Deps, run } from "../machine-diagram";
import { DIAGRAM_USAGE, FIX } from "../lib/machine-constants";
import { MachineLoadError } from "../lib/machine-load";
import { toMermaidBlock } from "../lib/machine-mermaid";
import { deadEndMachine, toFinalMachine } from "../lib/__tests__/fixtures/machines";

function harness(load: Deps["load"]) {
  const out: string[] = [];
  const err: string[] = [];
  const exec = (argv: readonly string[]) => Effect.runPromise(run(argv, { load, out: (line) => out.push(line), err: (line) => err.push(line) }));
  return { out, err, exec };
}

describe("machine-diagram run", () => {
  it.each([
    ["no file", []],
    ["two files", ["a.machine.ts", "b.machine.ts"]],
    ["a flag", ["--help"]],
  ])("prints usage and exits 2 on %s, so a wrong call never prints a partial diagram", async (_name, argv) => {
    const { out, err, exec } = harness(() => Effect.die("load must not run"));
    expect(await exec(argv)).toBe(2);
    expect(err).toEqual([DIAGRAM_USAGE]);
    expect(out).toEqual([]);
  });

  it("prints one fenced block per machine with a blank line between, so two diagrams never run together", async () => {
    const { out, err, exec } = harness((file) =>
      Effect.succeed([
        { file, exportName: "deadEndMachine", machine: deadEndMachine },
        { file, exportName: "toFinalMachine", machine: toFinalMachine },
      ]),
    );
    expect(await exec(["app/a.machine.ts"])).toBe(0);
    expect(out).toEqual([...toMermaidBlock(deadEndMachine), "", ...toMermaidBlock(toFinalMachine)]);
    expect(err).toEqual([]);
  });

  it("exits 1 with the fix when the file exports no machine, so an empty diagram is never printed as success", async () => {
    const { out, err, exec } = harness(() => Effect.succeed([]));
    expect(await exec(["app/a.machine.ts"])).toBe(1);
    expect(err).toEqual([`app/a.machine.ts: the file exports no XState machine. Do this instead: ${FIX.noMachine}.`]);
    expect(out).toEqual([]);
  });

  it("exits 1 with the cause and the fix when the file does not load, so a broken import is explained instead of thrown", async () => {
    const { out, err, exec } = harness((file) => Effect.fail(new MachineLoadError({ file, cause: new Error("boom") })));
    expect(await exec(["app/a.machine.ts"])).toBe(1);
    expect(err).toEqual(["app/a.machine.ts: the file does not load: boom. Do this instead: run `bun app/a.machine.ts` to see why, and fix the import."]);
    expect(out).toEqual([]);
  });
});
