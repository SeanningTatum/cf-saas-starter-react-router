import { describe, expect, it } from "vitest";
import { lint, type CliDeps } from "../cli";
import { RULES_END, RULES_START, USAGE } from "../constants";
import { memoryRepo } from "../repo";
import { renderRules } from "../rules-page";
import { badWordRule, baselineText, recordedGit } from "./fixtures";

const cleanBaseline = () => baselineText({ debt: { "no-bad": {} } });

const mainAt = (baseBaseline: string | undefined): Record<string, string> => ({
  "rev-parse --abbrev-ref HEAD": "feature",
  "symbolic-ref --short refs/remotes/origin/HEAD": "origin/main",
  "rev-parse --verify --quiet origin/main^{commit}": "1111111111111111",
  "merge-base HEAD origin/main": "2222222222222222",
  ...(baseBaseline === undefined ? {} : { "show 2222222222222222:scripts/lint/baseline.json": baseBaseline }),
});

function cli(files: Record<string, string | undefined>, overrides: Partial<CliDeps> = {}) {
  const present = Object.fromEntries(Object.entries(files).flatMap(([path, text]) => (text === undefined ? [] : [[path, text]])));
  const recorded = recordedGit(mainAt(cleanBaseline()));
  const written: [string, string][] = [];
  const asked: string[] = [];
  const deps: CliDeps = {
    root: "/repo",
    cwd: "/repo",
    repo: memoryRepo(present),
    registry: { rules: [badWordRule()], problems: [] },
    env: {},
    git: recorded.git,
    pullRequestTarget: () => {
      asked.push("pullRequestTarget");
      return undefined;
    },
    writeFile: (path, text) => {
      written.push([path, text]);
    },
    ...overrides,
  };
  return { run: (...argv: string[]) => lint(argv, deps), gitCalls: recorded.calls, asked, written };
}

const withBaseline = (extra: Record<string, string> = {}) => ({ "scripts/lint/baseline.json": cleanBaseline(), ...extra });

describe("lint: arguments", () => {
  it.each([
    ["an unknown option", ["--nope"], "unknown option: --nope"],
    ["two options", ["--rules", "--selftest"], "pass one option, or file paths, not both"],
    ["an option plus a file", ["--rules", "app/a.ts"], "pass one option, or file paths, not both"],
  ])("returns 2 with the usage for %s", (_name, argv, first) => {
    const outcome = cli(withBaseline()).run(...argv);

    expect(outcome.code).toBe(2);
    expect(outcome.stderr).toEqual([first, ...USAGE]);
  });

  it("prints the usage with code 0 for --help", () => {
    expect(cli(withBaseline()).run("--help")).toEqual({ code: 0, stdout: USAGE, stderr: [] });
  });
});

describe("lint: whole repo", () => {
  it("returns 0 on a clean repo and says which base it compared with", () => {
    const outcome = cli(withBaseline({ "app/a.ts": "const GOOD = 1;" })).run();

    expect(outcome.code).toBe(0);
    expect(outcome.stdout.join("\n")).toContain("compared with 2222222 (the default branch, main)");
  });

  it("returns 1 on a finding and prints the house-shape line and a count", () => {
    const outcome = cli(withBaseline({ "app/a.ts": "const GOOD = 1;\nconst BAD = 2;" })).run();

    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toEqual([
      "app/a.ts:2 no-bad: BAD found. Do this instead: write GOOD.",
      "house lint: 1 finding(s). Each line says the fix.",
    ]);
  });

  it.each([
    ["a missing baseline file", undefined],
    ["a baseline that does not parse", "{ not json"],
  ])("returns 1 with baseline-shape for %s", (_name, text) => {
    const outcome = cli({ "scripts/lint/baseline.json": text, "app/a.ts": "const GOOD = 1;" }).run();

    expect(outcome.code).toBe(1);
    expect(outcome.stderr[0]).toMatch(/^scripts\/lint\/baseline\.json:1 baseline-shape: /);
  });

  it("returns 1 with baseline-base in CI when GITHUB_BASE_REF names a ref git cannot read", () => {
    const outcome = cli(withBaseline({ "app/a.ts": "const GOOD = 1;" }), { env: { GITHUB_BASE_REF: "release" } }).run();

    expect(outcome.code).toBe(1);
    expect(outcome.stderr[0]).toMatch(/^scripts\/lint\/baseline\.json:1 baseline-base: /);
  });

  it("returns 1 with baseline-grew for a debt entry the base did not have, even though the entry matches the code", () => {
    const head = baselineText({ debt: { "no-bad": { "app/a.ts": 1 } } });
    const { git } = recordedGit(mainAt(cleanBaseline()));
    const outcome = cli({ "scripts/lint/baseline.json": head, "app/a.ts": "const BAD = 1;" }, { git }).run();

    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toHaveLength(2);
    expect(outcome.stderr[0]).toMatch(/^scripts\/lint\/baseline\.json:1 baseline-grew: debt\["no-bad"\]\["app\/a\.ts"\] is 1/);
  });

  it("returns 0 and says the base predates the linter when the base has neither the linter nor a baseline", () => {
    const { git } = recordedGit(mainAt(undefined));
    const outcome = cli(withBaseline({ "app/a.ts": "const GOOD = 1;" }), { git }).run();

    expect(outcome.code).toBe(0);
    expect(outcome.stdout.join("\n")).toContain("2222222 (the default branch, main) predates the linter");
  });

  it("returns 1 with baseline-base when the base has the linter and no baseline, so moving the baseline file does not skip the compare", () => {
    const { git } = recordedGit({ ...mainAt(undefined), "cat-file -e 2222222222222222:scripts/lint/cli.ts": "" });
    const outcome = cli(withBaseline({ "app/a.ts": "const GOOD = 1;" }), { git }).run();

    expect(outcome.code).toBe(1);
    expect(outcome.stderr[0]).toMatch(/^scripts\/lint\/baseline\.json:1 baseline-base: .*has the linter and no baseline/);
  });

  it("returns 1 with baseline-base when the base's baseline does not parse, so a broken base does not skip the compare", () => {
    const { git } = recordedGit(mainAt("{ broken"));
    const outcome = cli(withBaseline({ "app/a.ts": "const GOOD = 1;" }), { git }).run();

    expect(outcome.code).toBe(1);
    expect(outcome.stderr[0]).toMatch(/^scripts\/lint\/baseline\.json:1 baseline-base: .*does not parse/);
  });
});

describe("lint: file mode", () => {
  it("never calls git or gh, and prints only findings in the named files", () => {
    const run = cli(withBaseline({ "app/a.ts": "const BAD = 1;", "app/b.ts": "const BAD = 1;" }));

    const outcome = run.run("app/a.ts");

    expect(run.gitCalls).toEqual([]);
    expect(run.asked).toEqual([]);
    expect(outcome.code).toBe(1);
    expect(outcome.stderr).toEqual([
      "app/a.ts:1 no-bad: BAD found. Do this instead: write GOOD.",
      "house lint: 1 finding(s). Each line says the fix.",
    ]);
  });

  it("resolves a named file against the working directory, not the repo root", () => {
    const run = cli(withBaseline({ "app/a.ts": "const BAD = 1;" }), { cwd: "/repo/app" });

    expect(run.run("a.ts").stderr[0]).toBe("app/a.ts:1 no-bad: BAD found. Do this instead: write GOOD.");
  });

  it("ignores a named file outside the repo root", () => {
    const run = cli(withBaseline({ "app/a.ts": "const BAD = 1;" }));

    expect(run.run("../elsewhere/app/a.ts")).toMatchObject({ code: 0, stdout: ["house lint: clean. 0 file(s), 1 rule(s)."] });
  });

  it("returns 2 for a named file that does not exist, so a mistyped path is not reported as clean", () => {
    const outcome = cli(withBaseline({ "app/a.ts": "const BAD = 1;" })).run("app/b.ts");

    expect(outcome.code).toBe(2);
    expect(outcome.stderr[0]).toContain("no such file: app/b.ts");
  });
});

describe("lint: docs", () => {
  const freshPage = () => `# Lint rules\n\n${RULES_START}\n${renderRules([badWordRule()])}\n${RULES_END}\n`;
  const stalePage = () => `# Lint rules\n\n${RULES_START}\nold table\n${RULES_END}\n`;

  it("returns 1 from --check-docs on a stale page and 0 on a fresh one", () => {
    expect(cli(withBaseline({ "docs/agents/lint-rules.md": stalePage() })).run("--check-docs").code).toBe(1);
    expect(cli(withBaseline({ "docs/agents/lint-rules.md": freshPage() })).run("--check-docs").code).toBe(0);
  });

  it("writes the fresh page with --write-docs", () => {
    const run = cli(withBaseline({ "docs/agents/lint-rules.md": stalePage() }));

    expect(run.run("--write-docs").code).toBe(0);
    expect(run.written).toEqual([["docs/agents/lint-rules.md", freshPage()]]);
  });

  it("does not write and returns 1 with --write-docs when the page has no markers", () => {
    const run = cli(withBaseline({ "docs/agents/lint-rules.md": "# Lint rules\n" }));

    expect(run.run("--write-docs").code).toBe(1);
    expect(run.written).toEqual([]);
  });
});

describe("lint: registry problems", () => {
  it.each<[string[]]>([[[]], [["app/a.ts"]], [["--rules"]], [["--selftest"]], [["--check-docs"]], [["--write-docs"]]])(
    "fail the run with argv %j, and nothing is written",
    (argv) => {
      const problem = "scripts/lint/rules/broken.ts: export the rule as `export const rule: FileRule | RepoRule`";
      const run = cli(withBaseline({ "app/a.ts": "const GOOD = 1;", "docs/agents/lint-rules.md": `${RULES_START}\nold\n${RULES_END}` }), {
        registry: { rules: [badWordRule()], problems: [problem] },
      });

      const outcome = run.run(...argv);

      expect(outcome.code).toBe(1);
      expect(outcome.stderr).toContain(problem);
      expect(run.written).toEqual([]);
    }
  );
});
