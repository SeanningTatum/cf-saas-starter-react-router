import { describe, expect, it } from "vitest";
import { applyBaseline } from "../baseline";
import { baseline, finding, ran } from "./fixtures";

const ruleIds = () => ["no-bad", "other"];

const twoRuleDebt = (noBad: Record<string, number>) => ({ "no-bad": noBad, other: {} });

const rulesOf = (found: { rule: string }[]) => found.map((entry) => entry.rule);

describe("applyBaseline: debt", () => {
  it("drops every finding in a file when the count equals the debt", () => {
    const found = applyBaseline(
      baseline({ debt: twoRuleDebt({ "app/a.ts": 2 }) }),
      ran([finding("no-bad", "app/a.ts", 1), finding("no-bad", "app/a.ts", 9)]),
      ruleIds(),
    );

    expect(found).toEqual([]);
  });

  it("keeps every finding in the file, not just the extra one, and names both numbers when the count passes the debt", () => {
    const found = applyBaseline(
      baseline({ debt: twoRuleDebt({ "app/a.ts": 1 }) }),
      ran([finding("no-bad", "app/a.ts", 1), finding("no-bad", "app/a.ts", 9)]),
      ruleIds(),
    );

    expect(found.map((entry) => [entry.rule, entry.line])).toEqual([
      ["no-bad", 1],
      ["no-bad", 9],
    ]);
    for (const entry of found) expect(entry.message).toContain("(this file counts 2, the baseline allows 1)");
  });

  it("does not let debt in one file excuse the same rule in another file, or another rule in the same file", () => {
    const found = applyBaseline(
      baseline({ debt: twoRuleDebt({ "app/a.ts": 1 }) }),
      ran([finding("no-bad", "app/a.ts"), finding("no-bad", "app/b.ts"), finding("other", "app/a.ts")]),
      ruleIds(),
    );

    expect(found.map((entry) => [entry.rule, entry.file])).toEqual([
      ["no-bad", "app/b.ts"],
      ["other", "app/a.ts"],
    ]);
  });

  it("reports baseline-stale with the new count when the code holds fewer findings than the debt", () => {
    const found = applyBaseline(baseline({ debt: twoRuleDebt({ "app/a.ts": 3 }) }), ran([finding("no-bad", "app/a.ts")]), ruleIds());

    expect(rulesOf(found)).toEqual(["baseline-stale"]);
    expect(found[0]?.message).toContain("is 3, and the linter finds 1");
    expect(found[0]?.fix).toBe('run `bun run lint:house --lower-baseline`, or by hand set `debt["no-bad"]["app/a.ts"]` to 1');
  });

  it("tells you to delete the debt entry, not set it to 0, when the file is now clean", () => {
    const found = applyBaseline(baseline({ debt: twoRuleDebt({ "app/a.ts": 2 }) }), ran([]), ruleIds());

    expect(rulesOf(found)).toEqual(["baseline-stale"]);
    expect(found[0]?.fix).toBe('run `bun run lint:house --lower-baseline`, or by hand delete "app/a.ts" from `debt["no-bad"]`');
  });
});

describe("applyBaseline: boundaries", () => {
  it("drops every finding of the bounded rule in the bounded file, and no other rule's", () => {
    const found = applyBaseline(
      baseline({ boundaries: { "no-bad": { "app/a.ts": "framework contract" } }, debt: twoRuleDebt({}) }),
      ran([
        finding("no-bad", "app/a.ts", 1),
        finding("no-bad", "app/a.ts", 2),
        finding("no-bad", "app/a.ts", 3),
        finding("other", "app/a.ts", 4),
        finding("no-bad", "app/b.ts", 5),
      ]),
      ruleIds(),
    );

    expect(found.map((entry) => [entry.rule, entry.file])).toEqual([
      ["other", "app/a.ts"],
      ["no-bad", "app/b.ts"],
    ]);
  });

  it("reports baseline-stale for a boundary on a file where the rule finds nothing", () => {
    const found = applyBaseline(
      baseline({ boundaries: { "no-bad": { "app/a.ts": "framework contract" } }, debt: twoRuleDebt({}) }),
      ran([finding("other", "app/a.ts")]),
      ruleIds(),
    );

    expect(found.filter((entry) => entry.rule === "baseline-stale").map((entry) => entry.fix)).toEqual([
      'run `bun run lint:house --lower-baseline`, or by hand delete "app/a.ts" from `boundaries["no-bad"]`',
    ]);
  });
});

describe("applyBaseline: rule keys and suppressions", () => {
  it("reports baseline-shape for a debt key and a boundary key that name no rule", () => {
    const found = applyBaseline(baseline({ boundaries: { phantom: {} }, debt: { ...twoRuleDebt({}), ghost: {} } }), ran([]), ruleIds());

    expect(rulesOf(found)).toEqual(["baseline-shape", "baseline-shape"]);
    expect(found.map((entry) => entry.message).join(" ")).toMatch(/"ghost".*"phantom"|"phantom".*"ghost"/);
  });

  it("reports baseline-shape for a rule with no key under debt, so a new rule cannot dodge the shrink-only check", () => {
    const found = applyBaseline(baseline({ debt: { "no-bad": {} } }), ran([]), ruleIds());

    expect(rulesOf(found)).toEqual(["baseline-shape"]);
    expect(found[0]?.message).toContain('"other"');
  });

  it.each([
    ["more suppressions than allowed is baseline-grew", 1, 2, ["baseline-grew"]],
    ["fewer suppressions than allowed is baseline-stale", 2, 1, ["baseline-stale"]],
    ["the allowed number of suppressions is clean", 2, 2, []],
  ])("%s", (_name, allowed, held, expected) => {
    const found = applyBaseline(baseline({ suppressions: allowed, debt: twoRuleDebt({}) }), ran([], held), ruleIds());

    expect(rulesOf(found)).toEqual(expected);
  });
});

describe("applyBaseline in file mode", () => {
  it("skips the suppression total and the rule-key checks, which only hold over the whole repo", () => {
    const wrongEverywhere = baseline({ suppressions: 5, debt: { "no-bad": {}, ghost: {} } });

    expect(applyBaseline(wrongEverywhere, ran([], 0), ruleIds(), new Set(["app/a.ts"]))).toEqual([]);
    expect(applyBaseline(wrongEverywhere, ran([], 0), ruleIds())).toHaveLength(3);
  });

  it("checks stale debt and stale boundaries only in the named files", () => {
    const found = applyBaseline(
      baseline({
        boundaries: { "no-bad": { "app/a.ts": "why", "app/b.ts": "why" } },
        debt: { "no-bad": {}, other: { "app/a.ts": 1, "app/b.ts": 1 } },
      }),
      ran([]),
      ruleIds(),
      new Set(["app/a.ts"]),
    );

    expect(found.map((entry) => entry.rule)).toEqual(["baseline-stale", "baseline-stale"]);
    for (const entry of found) {
      expect(entry.message).toContain("app/a.ts");
      expect(entry.message).not.toContain("app/b.ts");
    }
  });

  it("still keeps findings over the debt in a named file", () => {
    const found = applyBaseline(baseline({ debt: twoRuleDebt({}) }), ran([finding("no-bad", "app/a.ts")]), ruleIds(), new Set(["app/a.ts"]));

    expect(found).toEqual([finding("no-bad", "app/a.ts")]);
  });
});

describe("applyBaseline: a finding that weighs more than one", () => {
  const longFile = (lines: number) => ran([{ ...finding("no-bad", "app/long.ts"), weight: lines }]);
  const allows = (lines: number) => baseline({ debt: twoRuleDebt({ "app/long.ts": lines }) });

  it("fails a baselined file that grew, so a file excused at 1,000 lines cannot drift to 1,010", () => {
    const found = applyBaseline(allows(1000), longFile(1010), ruleIds());

    expect(rulesOf(found)).toEqual(["no-bad"]);
    expect(found[0]?.message).toContain("this file counts 1010, the baseline allows 1000");
  });

  it("counts a weight below one as one, so no rule can cancel another finding with a zero or negative weight", () => {
    const run = ran([
      { ...finding("no-bad", "app/long.ts"), weight: -5 },
      { ...finding("no-bad", "app/long.ts"), weight: 0 },
    ]);

    expect(rulesOf(applyBaseline(allows(1), run, ruleIds()))).toEqual(["no-bad", "no-bad"]);
  });

  it("excuses the file at exactly its recorded weight", () => {
    expect(applyBaseline(allows(1000), longFile(1000), ruleIds())).toEqual([]);
  });

  it("asks for the lower number when the file shrank but is still over the cap", () => {
    const found = applyBaseline(allows(1000), longFile(990), ruleIds());

    expect(rulesOf(found)).toEqual(["baseline-stale"]);
    expect(found[0]?.message).toContain("is 1000, and the linter finds 990");
  });
});
