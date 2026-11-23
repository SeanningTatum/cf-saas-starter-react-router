import { describe, expect, it } from "vitest";
import {
  BIOME_BIN,
  EXIT,
  IMPORT_CYCLE_RULE,
  KNIP_BIN,
  LEGACY_HOUSE_CHECKER,
  PACKAGE_FILE,
  SPAWN_FAILED_STATUS,
} from "../lib/lint-constants";
import { type Deps, lint, parseArgs, type RunResult, realDeps } from "../lint-all";

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
  packageJson?: string | undefined;
  existing?: readonly string[];
}

interface Fake {
  deps: Deps;
  calls: Call[];
  out: string[];
  err: string[];
}

const ok = (stdout: string): RunResult => ({ status: 0, stdout, stderr: "" });
const failed = (stdout: string, stderr = "boom"): RunResult => ({ status: 1, stdout, stderr });

const CLEAN_BIOME = '{"summary":{"errors":0},"diagnostics":[],"command":"check"}';
const CLEAN_KNIP = "Using latest D1 database: miniflare-D1DatabaseObject/abc.sqlite\n{\"issues\":[]}\n";
const CLEAN_LEGACY = "Five non-negotiables: clean — 120 source file(s), AST-swept\n";
const WITH_HOUSE_SCRIPT = JSON.stringify({ scripts: { lint: "bun run scripts/lint-all.ts", "lint:house": "bun scripts/house.ts" } });
const WITHOUT_HOUSE_SCRIPT = JSON.stringify({ scripts: { lint: "bun run scripts/lint-all.ts" } });

const CYCLES_FLAG = `--only=${IMPORT_CYCLE_RULE}`;
const CYCLE_FINDING =
  '{"diagnostics":[{"severity":"warning","message":"This import is part of a cycle.","category":"lint/suspicious/noImportCycles","location":{"path":"app/lib/a.ts","start":{"line":1,"column":19}}}]}';
const BIOME_FINDING =
  '{"diagnostics":[{"severity":"error","message":"Unexpected any. Specify a different type.","category":"lint/suspicious/noExplicitAny","location":{"path":"app/a.ts","start":{"line":3,"column":7}}}]}';
const KNIP_FINDING = '{"issues":[{"file":"app/old.ts","exports":[{"name":"helper","line":4,"col":17}]}]}';
const LEGACY_FINDINGS = [
  "Five non-negotiables: 2 violation(s)",
  "",
  "  1-effect-ts (2):",
  "    app/lib/a.ts:12 — `throw` statement",
  "    app/lib/b.ts:4 — try/catch outside Effect.tryPromise",
].join("\n");

function fake(setup: Setup = {}): Fake {
  const calls: Call[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const packageJson = "packageJson" in setup ? setup.packageJson : WITH_HOUSE_SCRIPT;
  const usesLegacy = packageJson === WITHOUT_HOUSE_SCRIPT || packageJson === undefined;
  const deps: Deps = {
    run: (command, args) => {
      calls.push({ command, args });
      if (command === BIOME_BIN && args.includes(CYCLES_FLAG)) return setup.cycles ?? ok(CLEAN_BIOME);
      if (command === BIOME_BIN) return setup.biome ?? ok(CLEAN_BIOME);
      if (command === KNIP_BIN) return setup.knip ?? ok(CLEAN_KNIP);
      if (command === "git") return setup.git ?? ok("");
      if (command === "bun") return setup.house ?? ok(usesLegacy ? CLEAN_LEGACY : "");
      return { status: SPAWN_FAILED_STATUS, stdout: "", stderr: `unexpected command ${command}` };
    },
    readFile: (file) => (file === PACKAGE_FILE ? packageJson : undefined),
    exists: (file) => setup.existing === undefined || setup.existing.includes(file),
    print: (line) => out.push(line),
    printError: (line) => err.push(line),
  };
  return { deps, calls, out, err };
}

const commands = (f: Fake): string[] => f.calls.map((call) => call.command);
const argsOf = (f: Fake, command: string): readonly string[] | undefined =>
  f.calls.find((call) => call.command === command)?.args;

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
      house: failed("app/lib/c.ts:8 house/no-throw: use Effect.fail\n", ""),
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
    ["the house binary cannot start", { house: { status: SPAWN_FAILED_STATUS, stdout: "", stderr: "cannot run bun" } }],
    ["the legacy house checker exits non-zero with no finding", { packageJson: WITHOUT_HOUSE_SCRIPT, house: failed("") }],
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

  it("runs the legacy checker when package.json has no lint:house script and keeps only findings for the given files", () => {
    const f = fake({ packageJson: WITHOUT_HOUSE_SCRIPT, house: failed(LEGACY_FINDINGS, "") });
    expect(lint(["app/lib/b.ts"], f.deps)).toBe(EXIT.findings);
    expect(argsOf(f, "bun")).toEqual(["run", LEGACY_HOUSE_CHECKER]);
    expect(f.out).toEqual(["app/lib/b.ts:4 house/1-effect-ts: try/catch outside Effect.tryPromise"]);
  });

  it("treats legacy findings outside the given files as clean, so a scoped run does not fail on other files", () => {
    const f = fake({ packageJson: WITHOUT_HOUSE_SCRIPT, house: failed(LEGACY_FINDINGS, "") });
    expect(lint(["app/lib/z.ts"], f.deps)).toBe(EXIT.clean);
    expect(f.err).toEqual([]);
  });

  it("matches legacy findings for a file given as ./path, so a leading ./ never hides a finding", () => {
    const f = fake({ packageJson: WITHOUT_HOUSE_SCRIPT, house: failed(LEGACY_FINDINGS, "") });
    expect(lint(["./app/lib/a.ts"], f.deps)).toBe(EXIT.findings);
    expect(f.out).toContain("app/lib/a.ts:12 house/1-effect-ts: `throw` statement");
  });

  it("puts -- before the file arguments, so a file name that starts with a dash is never read as a Biome option", () => {
    const f = fake();
    lint(["-odd.ts", "app/a.ts"], f.deps);
    const args = argsOf(f, BIOME_BIN) ?? [];
    expect(args.slice(args.indexOf("--") + 1)).toEqual(["-odd.ts", "app/a.ts"]);
  });

  it("does not start the legacy checker for a file outside app/ and workers/, which it never reads", () => {
    const f = fake({ packageJson: WITHOUT_HOUSE_SCRIPT });
    expect(lint(["scripts/roster.ts"], f.deps)).toBe(EXIT.clean);
    expect(commands(f)).toEqual([BIOME_BIN]);
  });

  it("falls back to the legacy checker when package.json is missing or not JSON", () => {
    for (const packageJson of [undefined, "{not json"]) {
      const f = fake({ packageJson, house: failed(LEGACY_FINDINGS, "") });
      expect(lint([], f.deps)).toBe(EXIT.findings);
      expect(argsOf(f, "bun")).toEqual(["run", LEGACY_HOUSE_CHECKER]);
      expect(f.out.filter((line) => line.includes("house/1-effect-ts"))).toHaveLength(2);
    }
  });
});

describe("lint --staged", () => {
  it("asks git for the staged files, passes --staged to Biome, the existing lintable files to the house linter, and skips knip", () => {
    const f = fake({ git: ok("app/a.ts\ndocs/notes.md\napp/gone.ts\n\n"), existing: ["app/a.ts", "docs/notes.md"] });
    expect(lint(["--staged"], f.deps)).toBe(EXIT.clean);
    expect(commands(f)).toEqual(["git", BIOME_BIN, "bun"]);
    expect(argsOf(f, "git")).toEqual(expect.arrayContaining(["diff", "--cached", "--name-only"]));
    expect(argsOf(f, BIOME_BIN)?.at(-1)).toBe("--staged");
    expect(argsOf(f, BIOME_BIN)).not.toContain(".");
    expect(argsOf(f, "bun")).toEqual(["run", "lint:house", "app/a.ts"]);
  });

  it("returns 0 without running a linter when nothing lintable is staged", () => {
    const f = fake({ git: ok("README.md\n") });
    expect(lint(["--staged"], f.deps)).toBe(EXIT.clean);
    expect(commands(f)).toEqual(["git"]);
  });

  it("returns 2 and runs no linter when git cannot list the staged files", () => {
    const f = fake({ git: { status: 128, stdout: "", stderr: "fatal: not a git repository" } });
    expect(lint(["--staged"], f.deps)).toBe(EXIT.toolFailed);
    expect(commands(f)).toEqual(["git"]);
    expect(f.err.join("\n")).toContain("fatal: not a git repository");
  });
});

describe("realDeps", () => {
  it("reports a binary that cannot start as a non-zero status, so a missing tool is never a clean run", () => {
    const result = realDeps().run("lint-all-test-no-such-binary", []);
    expect(result.status).toBe(SPAWN_FAILED_STATUS);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("lint-all-test-no-such-binary");
  });
});
