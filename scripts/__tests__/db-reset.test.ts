import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Effect, Either, Exit, Option } from "effect";
import { DevServerRunningError, SeedError } from "../../app/models/errors/fixture";
import type { RunResult, Shell } from "../lib/shell";
import { describeResetFailure, holdersOf, reset } from "../db-reset";

const STATE = "/repo/.wrangler/state/v3";
const OK: RunResult = { code: 0, stdout: "", stderr: "" };

function fake(answer: (line: string) => RunResult = () => OK) {
  const calls: string[] = [];
  const shell: Shell = {
    cwd: "/repo",
    run: (command, args) => {
      const line = `${command} ${args.join(" ")}`;
      calls.push(line);
      return answer(line);
    },
    read: () => undefined,
    write: (path) => calls.push(`write ${path}`),
    tempDir: (prefix) => `/tmp/${prefix}1`,
    remove: (path) => calls.push(`remove ${path}`),
    out: () => {},
    err: () => {},
  };
  return { shell, calls };
}

const present = () => true;

const failureOf = <E>(exit: Exit.Exit<void, E>): Option.Option<E> => (Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none());

describe("reset", () => {
  it.effect("refuses with DevServerRunningError listing the pids and deletes nothing while a process holds the local state", () =>
    Effect.gen(function* () {
      const { shell, calls } = fake((line) => (line.startsWith("lsof") ? { code: 0, stdout: "123\n456\n", stderr: "" } : OK));
      const failure = failureOf(yield* Effect.exit(reset("base", shell, present)));
      expect(Option.isSome(failure) && failure.value).toBeInstanceOf(DevServerRunningError);
      expect(Option.map(failure, (e) => (e instanceof DevServerRunningError ? [e.pids, e.stateDir] : []))).toEqual(Option.some([[123, 456], STATE]));
      expect(calls).toEqual([`lsof -t +D ${STATE}`]);
    }),
  );

  it.effect("with no holder, wipes d1 and r2, then migrates, then seeds the chosen scenario, in that order", () =>
    Effect.gen(function* () {
      const { shell, calls } = fake();
      yield* reset("many-users", shell, present);
      expect(calls).toEqual([
        `lsof -t +D ${STATE}`,
        `remove ${STATE}/d1`,
        `remove ${STATE}/r2`,
        "bun run db:migrate:local",
        "bun scripts/seed-preview.ts --scenario many-users",
      ]);
    }),
  );

  it.effect("fails with a local SeedError and skips the seed when the migration fails", () =>
    Effect.gen(function* () {
      const { shell, calls } = fake((line) => (line.includes("migrate") ? { code: 1, stdout: "", stderr: "no such table" } : OK));
      const failure = failureOf(yield* Effect.exit(reset("base", shell, present)));
      expect(Option.isSome(failure) && failure.value).toBeInstanceOf(SeedError);
      expect(Option.map(failure, (e) => (e instanceof SeedError ? [e.target, e.scenario] : []))).toEqual(Option.some(["local", "base"]));
      expect(Option.map(failure, (e) => e instanceof SeedError && e.message.includes("no such table"))).toEqual(Option.some(true));
      expect(calls.some((line) => line.includes("seed-preview"))).toBe(false);
    }),
  );

  it.effect("refuses with a SeedError and deletes nothing when lsof cannot run, so a failed check never reads as no dev server", () =>
    Effect.gen(function* () {
      const { shell, calls } = fake((line) => (line.startsWith("lsof") ? { code: 1, stdout: "", stderr: "spawnSync lsof EACCES" } : OK));
      const failure = failureOf(yield* Effect.exit(reset("base", shell, present)));
      expect(Option.isSome(failure) && failure.value).toBeInstanceOf(SeedError);
      expect(calls).toEqual([`lsof -t +D ${STATE}`]);
    }),
  );

  it.effect("skips the holder check when there is no local state yet, since nothing can hold it", () =>
    Effect.gen(function* () {
      const { shell, calls } = fake();
      yield* reset("base", shell, () => false);
      expect(calls[0]).toBe(`remove ${STATE}/d1`);
    }),
  );

  it.effect("fails with SeedError when the seed step fails after the migration", () =>
    Effect.gen(function* () {
      const { shell } = fake((line) => (line.includes("seed-preview") ? { code: 1, stdout: "", stderr: "boom" } : OK));
      const failure = failureOf(yield* Effect.exit(reset("empty", shell, present)));
      expect(Option.isSome(failure) && failure.value).toBeInstanceOf(SeedError);
    }),
  );
});

describe("holdersOf", () => {
  it("reads the pid lines and ignores anything that is not a number", () => {
    const { shell } = fake(() => ({ code: 0, stdout: "123\nCOMMAND\n  456  \n\n12a\n", stderr: "" }));
    expect(holdersOf(shell, STATE)).toEqual(Either.right([123, 456]));
  });

  it("yields no pids when lsof finds no holder (code 1, empty output), so reset still runs", () => {
    const { shell } = fake(() => ({ code: 1, stdout: "", stderr: "" }));
    expect(holdersOf(shell, STATE)).toEqual(Either.right([]));
  });

  it("refuses when lsof is not installed or exits with an error, so a failed check never reads as no dev server", () => {
    for (const answer of [
      { code: 1, stdout: "", stderr: "spawnSync lsof ENOENT" },
      { code: 1, stdout: "", stderr: "lsof: WARNING - can't stat()" },
      { code: 2, stdout: "", stderr: "" },
    ]) {
      const { shell } = fake(() => answer);
      expect(Either.isLeft(holdersOf(shell, STATE))).toBe(true);
    }
  });
});

describe("describeResetFailure", () => {
  it("names the pids and says nothing was deleted for a running dev server, and points at db:prepare after a failed rebuild", () => {
    const busy = describeResetFailure(new DevServerRunningError({ pids: [7, 8], stateDir: STATE }));
    expect(busy).toContain("7, 8");
    expect(busy).toContain("Nothing was deleted");
    const broken = describeResetFailure(new SeedError({ scenario: "base", target: "local", message: "boom" }));
    expect(broken).toContain("bun run db:prepare");
    expect(broken).toContain("boom");
  });
});
