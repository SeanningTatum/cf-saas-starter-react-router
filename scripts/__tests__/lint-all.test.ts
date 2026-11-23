import { describe, expect, it } from "vitest";
import { BIOME_BIN, EXIT, IMPORT_CYCLE_RULE, KNIP_BIN } from "../lib/lint-constants";
import { type Deps, lint, parseArgs, realDeps } from "../lint-all";
import type { RunResult } from "../lib/shell";

interface Call {
  command: string;
  args: readonly string[];
}

interface Setup {
  biome?: RunResult;
  house?: RunResult;
  cycles?: RunResult;
  knip?: RunResult;
  git?: RunResult;
  existing?: readonly string[];
}

interface Fake {
  deps: Deps;
  calls: Call[];
  out: string[];
  err: string[];
}

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: "" });
const failed = (stdout: string, stderr = "boom"): RunResult => ({ code: 1, stdout, stderr });

const CLEAN_BIOME = '{"summary":{"errors":0},"diagnostics":[],"command":"check"}';
const CLEAN_KNIP = 'Using latest D1 database: miniflare-D1DatabaseObject/abc.sqlite\n{"issues":[]}\n';
const CLEAN_HOUSE = "house lint: clean. 518 file(s), 13 rule(s).\n";

const CYCLES_FLAG = `--only=${IMPORT_CYCLE_RULE}`;
const CYCLE_FINDING =
  '{"diagnostics":[{"severity":"warning","message":"This import is part of a cycle.","category":"lint/suspicious/noImportCycles","location":{"path":"app/lib/a.ts","start":{"line":1,"column":19}}}]}';
const BIOME_FINDING =
  '{"diagnostics":[{"severity":"error","message":"Unexpected any. Specify a different type.","category":"lint/suspicious/noExplicitAny","location":{"path":"app/a.ts","start":{"line":3,"column":7}}}]}';
const KNIP_FINDING = '{"issues":[{"file":"app/old.ts","exports":[{"name":"helper","line":4,"col":17}]}]}';
const HOUSE_FINDINGS = [
  "app/lib/a.ts:12 no-throw: a `throw` statement. Do this instead: return Effect.fail(…).",
  "house lint: 1 finding(s). Each line says the fix.",
].join("\n");

function fake(setup: Setup = {}): Fake {
  const calls: Call[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const answers: Record<string, RunResult | undefined> = {
    [KNIP_BIN]: setup.knip ?? ok(CLEAN_KNIP),
    git: setup.git ?? ok(""),
    bun: setup.house ?? ok(CLEAN_HOUSE),
  };
  const deps: Deps = {
    run: (command, args) => {
      calls.push({ command, args });
      if (command === BIOME_BIN) return (args.includes(CYCLES_FLAG) ? setup.cycles : setup.biome) ?? ok(CLEAN_BIOME);
      return answers[command] ?? { code: 127, stdout: "", stderr: `unexpected command ${command}` };
    },
    exists: (file) => setup.existing === undefined || setup.existing.includes(file),
    print: (line) => out.push(line),
    printError: (line) => err.push(line),
  };
  return { deps, calls, out, err };
}

const commands = (f: Fake): string[] => f.calls.map((call) => call.command);
const argsOf = (f: Fake, command: string): readonly string[] | undefined => f.calls.find((call) => call.command === command)?.args;

describe("parseArgs", () => {
  it("splits flags from files, so --staged is never linted as a path", () => {
    expect(parseArgs(["--staged", "app/a.ts", "README.md"])).toEqual({
      staged: true,
      fix: false,
      files: ["app/a.ts", "README.md"],
    });
    expect(parseArgs(["--fix", "app/a.ts"])).toEqual({ staged: false, fix: true, files: ["app/a.ts"] });
    expect(parseArgs([])).toEqual({ staged: false, fix: false, files: [] });
  });
});

describe("lint --fix", () => {
  it("tells Biome to write its safe fixes only when --fix is given, so a plain run never edits a file", () => {
    const fixing = fake();
    lint(["--fix", "app/a.ts"], fixing.deps);
    expect(argsOf(fixing, BIOME_BIN)).toContain("--write");

    const checking = fake();
    lint(["app/a.ts"], checking.deps);
    expect(argsOf(checking, BIOME_BIN)).not.toContain("--write");
  });
});

describe("lint on the whole repo", () => {
  it("runs Biome on the repo, the house linter and knip, prints clean and returns 0", () => {
    const f = fake();
    expect(lint([], f.deps)).toBe(EXIT.clean);
    expect(commands(f)).toEqual([BIOME_BIN, "bun", BIOME_BIN, KNIP_BIN]);
    expect(argsOf(f, BIOME_BIN)).toContain("--reporter=json");
    expect(argsOf(f, BIOME_BIN)?.at(-1)).toBe(".");
    expect(argsOf(f, KNIP_BIN)).toEqual(expect.arrayContaining(["--reporter", "json"]));
    expect(f.out).toHaveLength(1);
    expect(f.out[0]).toMatch(/^lint: clean \(/);
    expect(f.err).toEqual([]);
  });

  it("returns 1 and prints each finding of every tool in the one shape", () => {
    const f = fake({
      biome: failed(BIOME_FINDING, ""),
      house: failed("app/lib/c.ts:8 no-throw: use Effect.fail\n", ""),
      cycles: failed(CYCLE_FINDING, ""),
      knip: failed(KNIP_FINDING, ""),
    });
    expect(lint([], f.deps)).toBe(EXIT.findings);
    expect(f.out).toEqual([
      "app/a.ts:3:7 lint/suspicious/noExplicitAny: Unexpected any. Specify a different type.",
      "app/lib/c.ts:8 house/no-throw: use Effect.fail",
      "app/lib/a.ts:1:19 lint/suspicious/noImportCycles: This import is part of a cycle.",
      expect.stringMatching(/^app\/old\.ts:4:17 knip\/exports: `helper`: .*Do this instead/),
    ]);
    expect(f.err.join("\n")).toContain("4 finding(s)");
    expect(f.err.join("\n")).not.toContain("could not run");
  });

  it.each<[string, Setup]>([
    ["Biome prints no JSON", { biome: failed("Biome crashed") }],
    ["Biome exits non-zero with no finding", { biome: failed(CLEAN_BIOME) }],
    ["the house linter exits non-zero with no finding", { house: failed("") }],
    ["the house binary cannot start", { house: { code: 1, stdout: "", stderr: "spawn bun ENOENT" } }],
    ["the house linter exits 2 for a bad option or a missing file", { house: { code: 2, stdout: "", stderr: "no such file: app/x.ts" } }],
    ["the import-cycle run prints no JSON", { cycles: failed("Biome crashed") }],
    ["knip prints no JSON", { knip: ok("ERROR: config invalid") }],
    ["knip exits non-zero with no finding", { knip: failed('{"issues":[]}') }],
  ])("returns 2 and says so on stderr when %s, because could not run is a failure, not a pass", (_name, setup) => {
    const f = fake(setup);
    expect(lint([], f.deps)).toBe(EXIT.toolFailed);
    expect(f.err.join("\n")).toMatch(/could not run/);
    expect(f.out.some((line) => line.startsWith("lint: clean"))).toBe(false);
  });

  it("still returns 2 when one tool fails and another has findings, so a broken tool is never hidden behind findings", () => {
    const f = fake({ biome: failed(BIOME_FINDING, ""), knip: ok("not json") });
    expect(lint([], f.deps)).toBe(EXIT.toolFailed);
    expect(f.out).toContain("app/a.ts:3:7 lint/suspicious/noExplicitAny: Unexpected any. Specify a different type.");
  });
});

describe("the import-cycle rule", () => {
  it("runs by name on the whole repo only, because its module-graph scan would make a one-file run slow", () => {
    const whole = fake();
    lint([], whole.deps);
    expect(whole.calls.filter((call) => call.args.includes(CYCLES_FLAG))).toHaveLength(1);

    const scoped = fake();
    lint(["app/a.ts"], scoped.deps);
    expect(scoped.calls.some((call) => call.args.includes(CYCLES_FLAG))).toBe(false);

    const staged = fake({ git: ok("app/a.ts\n") });
    lint(["--staged"], staged.deps);
    expect(staged.calls.some((call) => call.args.includes(CYCLES_FLAG))).toBe(false);
  });
});

describe("lint with file arguments", () => {
  it("passes only the lintable files to Biome and the house linter and skips knip", () => {
    const f = fake();
    expect(lint(["app/a.ts", "README.md", "app/b.tsx"], f.deps)).toBe(EXIT.clean);
    expect(commands(f)).toEqual([BIOME_BIN, "bun"]);
    const biomeArgs = argsOf(f, BIOME_BIN) ?? [];
    expect(biomeArgs.slice(-2)).toEqual(["app/a.ts", "app/b.tsx"]);
    expect(biomeArgs).not.toContain(".");
    expect(biomeArgs).not.toContain("README.md");
    expect(argsOf(f, "bun")).toEqual(["run", "lint:house", "app/a.ts", "app/b.tsx"]);
  });

  it("returns 0 without running any tool when no argument is lintable", () => {
    const f = fake();
    expect(lint(["README.md", "scripts/setup.sh"], f.deps)).toBe(EXIT.clean);
    expect(f.calls).toEqual([]);
    expect(f.out).toEqual(["lint: clean (no file to check)"]);
  });

  it("runs the house linter on the given files and reports its findings with the house/ prefix", () => {
    const f = fake({ house: failed(HOUSE_FINDINGS, "") });
    expect(lint(["app/lib/a.ts"], f.deps)).toBe(EXIT.findings);
    expect(argsOf(f, "bun")).toEqual(["run", "lint:house", "app/lib/a.ts"]);
    expect(f.out).toEqual(["app/lib/a.ts:12 house/no-throw: a `throw` statement. Do this instead: return Effect.fail(…)."]);
  });

  it("hands the house linter a ./path in its plain form, so a leading ./ never hides a finding", () => {
    const f = fake();
    lint(["./app/lib/a.ts"], f.deps);
    expect(argsOf(f, "bun")).toEqual(["run", "lint:house", "app/lib/a.ts"]);
  });

  it("puts -- before the file arguments, so a file name that starts with a dash is never read as a Biome option", () => {
    const f = fake();
    lint(["-odd.ts", "app/a.ts"], f.deps);
    const args = argsOf(f, BIOME_BIN) ?? [];
    expect(args.slice(args.indexOf("--") + 1)).toEqual(["-odd.ts", "app/a.ts"]);
  });
});

describe("lint --staged", () => {
  it("asks git for the staged files, passes --staged to Biome as an option and never as a path, the existing lintable files to the house linter, and skips knip", () => {
    const f = fake({ git: ok("app/a.ts\ndocs/notes.md\napp/gone.ts\n\n"), existing: ["app/a.ts", "docs/notes.md"] });
    expect(lint(["--staged"], f.deps)).toBe(EXIT.clean);
    expect(commands(f)).toEqual(["git", BIOME_BIN, "bun"]);
    expect(argsOf(f, "git")).toEqual(expect.arrayContaining(["diff", "--cached", "--name-only"]));
    const biomeArgs = argsOf(f, BIOME_BIN) ?? [];
    expect(biomeArgs).toContain("--staged");
    expect(biomeArgs.indexOf("--staged")).toBeLessThan(biomeArgs.indexOf("--"));
    expect(biomeArgs.at(-1)).toBe("--");
    expect(argsOf(f, BIOME_BIN)).not.toContain(".");
    expect(argsOf(f, "bun")).toEqual(["run", "lint:house", "app/a.ts"]);
  });

  it("returns 0 without running a linter when nothing lintable is staged", () => {
    const f = fake({ git: ok("README.md\n") });
    expect(lint(["--staged"], f.deps)).toBe(EXIT.clean);
    expect(commands(f)).toEqual(["git"]);
  });

  it("returns 2 and runs no linter when git cannot list the staged files", () => {
    const f = fake({ git: { code: 128, stdout: "", stderr: "fatal: not a git repository" } });
    expect(lint(["--staged"], f.deps)).toBe(EXIT.toolFailed);
    expect(commands(f)).toEqual(["git"]);
    expect(f.err.join("\n")).toContain("fatal: not a git repository");
  });
});

describe("realDeps", () => {
  it("reports a binary that cannot start as a non-zero status, so a missing tool is never a clean run", () => {
    const result = realDeps().run("lint-all-test-no-such-binary", []);
    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("lint-all-test-no-such-binary");
  });
});
