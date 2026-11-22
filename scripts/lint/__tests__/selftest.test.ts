import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadRules } from "../registry";
import { diskRepo } from "../repo";
import { selftest } from "../selftest";
import type { Rule } from "../types";
import { badWordRule, loadsEveryRuleTimeoutMs } from "./fixtures";

const realRepo = () => diskRepo(fileURLToPath(new URL("../../../", import.meta.url)));

const everythingExists = () => true;

const failuresOf = (rules: Rule[], exists: (path: string) => boolean = everythingExists) => selftest(rules, exists).failures;

describe("selftest over the real rules", () => {
  it("passes with no failures and keeps at least the 41 cases the old 1,007-line checker had, so the port dropped no coverage", async () => {
    const casesInTheOldChecker = 41;
    const repo = realRepo();
    const { rules, problems } = await loadRules();

    const result = selftest(rules, (path) => repo.read(path) !== undefined);

    expect(problems).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.rules).toBe(rules.length);
    expect(result.cases).toBeGreaterThanOrEqual(casesInTheOldChecker);
  }, loadsEveryRuleTimeoutMs);
});

describe("selftest over a rule with a broken shape", () => {
  it("passes a well-formed fake rule, so every failure below comes from the one field each test breaks", () => {
    expect(selftest([badWordRule()], everythingExists)).toEqual({ rules: 1, cases: 2, failures: [] });
  });

  it.each([
    ["an empty fix", badWordRule({ fix: "  " }), "`fix` is empty"],
    ["an empty matches", badWordRule({ matches: "" }), "`matches` is empty"],
    ["an empty covers", badWordRule({ covers: "" }), "`covers` is empty"],
    ["a fix that repeats the lead the runner adds", badWordRule({ fix: "Do this instead: write GOOD" }), "must not repeat"],
    ["an id that is not kebab-case", badWordRule({ id: "noBad" }), "kebab-case"],
    ["an id with a trailing dash", badWordRule({ id: "no-bad-" }), "kebab-case"],
    ["no clean case", badWordRule({ cases: [{ name: "BAD", files: { "app/a.ts": "BAD" }, expect: "finding" }] }), 'no case expects "clean"'],
    ["no finding case", badWordRule({ cases: [{ name: "GOOD", files: { "app/a.ts": "GOOD" }, expect: "clean" }] }), 'no case expects "finding"'],
  ])("fails %s", (_name, rule, expected) => {
    const failures = failuresOf([rule]);

    expect(failures.filter((failure) => failure.includes(expected))).toHaveLength(1);
    for (const failure of failures) expect(failure.startsWith(`${rule.id}: `)).toBe(true);
  });

  it("fails an example that does not exist in the repo", () => {
    const failures = failuresOf([badWordRule({ example: "app/gone.ts" })], (path) => path !== "app/gone.ts");

    expect(failures).toEqual(["no-bad: `example` names app/gone.ts, which does not exist"]);
  });

  it("fails the second of two rules with the same id", () => {
    expect(failuresOf([badWordRule(), badWordRule()])).toEqual(["no-bad: another rule has the same id"]);
  });
});

describe("selftest over a case whose expectation is wrong", () => {
  const withCase = (code: string, expected: "finding" | "clean") =>
    badWordRule({
      cases: [
        { name: "BAD is caught", files: { "app/a.ts": "BAD" }, expect: "finding" },
        { name: "GOOD is clean", files: { "app/a.ts": "GOOD" }, expect: "clean" },
        { name: "the wrong one", files: { "app/a.ts": code }, expect: expected },
      ],
    });

  it("fails a clean case that finds something, and quotes the line it printed", () => {
    expect(failuresOf([withCase("BAD", "clean")])).toEqual([
      'no-bad: case "the wrong one" expected no finding, got: app/a.ts:1 no-bad: BAD found. Do this instead: write GOOD.',
    ]);
  });

  it("fails a finding case that finds nothing", () => {
    expect(failuresOf([withCase("GOOD", "finding")])).toEqual(['no-bad: case "the wrong one" expected a finding, got none']);
  });

  it("fails a finding case whose line falls outside the house shape", () => {
    const blank = badWordRule({ check: () => [{ line: 1, message: "" }] });

    expect(failuresOf([blank])).toEqual([
      'no-bad: case "BAD is caught" printed a line outside the house shape: app/a.ts:1 no-bad: . Do this instead: write GOOD.',
      'no-bad: case "GOOD is clean" expected no finding, got: app/a.ts:1 no-bad: . Do this instead: write GOOD.',
    ]);
  });
});
