import { Effect, Either } from "effect";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { memoryRepo } from "../../lint/repo";
import { isMachine, loadMachines, MachineLoadError, machineFiles, machinesIn } from "../machine-load";
import { nestedMachine, soundMachine } from "./fixtures/machines";

const ROOT = resolve(__dirname, "..", "..", "..");
const FIXTURES = "scripts/lib/__tests__/fixtures/machines.ts";

describe("isMachine", () => {
  it("accepts a machine and rejects look-alikes, so a stray export is never walked as a machine", () => {
    expect(isMachine(soundMachine)).toBe(true);
    for (const value of [null, undefined, "machine", {}, { root: {}, getStateNodeById: () => undefined }]) expect(isMachine(value)).toBe(false);
  });
});

describe("machinesIn", () => {
  it("keeps machine exports only and counts one machine under two names once, so an alias does not double every finding", () => {
    const found = machinesIn("app/a.machine.ts", { soundMachine, alias: soundMachine, LIMIT: 3, nestedMachine });
    expect(found.map(({ file, exportName, machine }) => [file, exportName, machine])).toEqual([
      ["app/a.machine.ts", "soundMachine", soundMachine],
      ["app/a.machine.ts", "nestedMachine", nestedMachine],
    ]);
  });
});

describe("machineFiles", () => {
  it("keeps machine files under app/ and workers/ only and skips tests, so the gate neither misses a machine nor walks a fixture", () => {
    const repo = memoryRepo({
      "app/components/upload.machine.ts": "",
      "app/components/menu.machine.tsx": "",
      "app/components/upload.machine.test.ts": "",
      "app/components/upload.model.ts": "",
      "app/components/machine.ts": "",
      "app/components/__tests__/fake.machine.ts": "",
      "workers/jobs/queue.machine.ts": "",
      "scripts/lib/tool.machine.ts": "",
      "e2e/flow.machine.ts": "",
    });
    expect(machineFiles(repo)).toEqual(["app/components/menu.machine.tsx", "app/components/upload.machine.ts", "workers/jobs/queue.machine.ts"]);
  });
});

describe("loadMachines", () => {
  it("imports a real file and returns its machines tagged with the file, so the gate checks what the module exports", async () => {
    const loaded = await Effect.runPromise(loadMachines(ROOT, FIXTURES));
    expect(loaded.every(({ file }) => file === FIXTURES)).toBe(true);
    expect(loaded.map(({ exportName, machine }) => [exportName, machine.id])).toEqual(
      expect.arrayContaining([
        ["soundMachine", "sound"],
        ["nestedMachine", "nested"],
      ]),
    );
  });

  it("fails a missing file with MachineLoadError naming the file, so the gate reports it instead of crashing", async () => {
    const result = await Effect.runPromise(Effect.either(loadMachines(ROOT, "app/missing.machine.ts")));
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(MachineLoadError);
      expect(result.left.file).toBe("app/missing.machine.ts");
    }
  });
});
