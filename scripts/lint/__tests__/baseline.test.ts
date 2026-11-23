import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { baselineSize, compareWithBase, lowerBaseline, parseBaseline } from "../baseline";
import { BASELINE_PATH, FINDING_LINE } from "../constants";
import { formatFinding } from "../format";
import { baseline, finding, ran } from "./fixtures";

const shapeOf = (text: string): string => {
  const parsed = parseBaseline(text);
  return Either.isLeft(parsed) ? parsed.left.rule : "decoded";
};

describe("parseBaseline", () => {
  it("decodes a valid file with its boundaries and debt intact, so a schema edit cannot silently drop a section", () => {
    const text = JSON.stringify({
      suppressions: 2,
      boundaries: { "no-throw": { "app/lib/effect-trpc.ts": "tRPC reads a thrown error" } },
      debt: { "no-throw": {}, "no-try-catch": { "workers/app.ts": 3 } },
    });

    expect(Either.getOrUndefined(parseBaseline(text))).toEqual({
      suppressions: 2,
      boundaries: { "no-throw": { "app/lib/effect-trpc.ts": "tRPC reads a thrown error" } },
      debt: { "no-throw": {}, "no-try-catch": { "workers/app.ts": 3 } },
    });
  });

  it.each([
    ["a debt count of 0, which would keep a dead entry alive", { suppressions: 0, boundaries: {}, debt: { "no-throw": { "app/a.ts": 0 } } }],
    ["a fractional debt count", { suppressions: 0, boundaries: {}, debt: { "no-throw": { "app/a.ts": 1.5 } } }],
    ["a negative suppressions total", { suppressions: -1, boundaries: {}, debt: {} }],
    ["a missing debt key", { suppressions: 0, boundaries: {} }],
    ["a missing boundaries key", { suppressions: 0, debt: {} }],
    ["an empty boundary reason, which excuses a file without saying why", { suppressions: 0, boundaries: { "no-throw": { "app/a.ts": "" } }, debt: {} }],
  ])("rejects %s with baseline-shape", (_name, file) => {
    expect(shapeOf(JSON.stringify(file))).toBe("baseline-shape");
  });

  it("rejects a boundary reason of only spaces, since it explains no more than an empty one", () => {
    const file = { suppressions: 0, boundaries: { "no-throw": { "app/a.ts": "   " } }, debt: {} };

    expect(shapeOf(JSON.stringify(file))).toBe("baseline-shape");
  });

  it("rejects a top-level key it does not know, so a misspelt `debts` is not silently ignored", () => {
    const file = { suppressions: 0, boundaries: {}, debt: {}, debts: { "no-throw": { "app/a.ts": 1 } } };

    expect(shapeOf(JSON.stringify(file))).toBe("baseline-shape");
  });

  it("rejects text that is not JSON with a one-line baseline-shape finding on the baseline file, so the report stays in the house shape", () => {
    const parsed = parseBaseline("{ suppressions: 0,");

    expect(Either.isLeft(parsed)).toBe(true);
    if (Either.isRight(parsed)) return;
    expect(parsed.left).toMatchObject({ rule: "baseline-shape", file: BASELINE_PATH, line: 1 });
    expect(parsed.left.message).not.toContain("\n");
    expect(formatFinding(parsed.left)).toMatch(FINDING_LINE);
  });
});

describe("compareWithBase: a baseline cannot be grown by hand", () => {
  const atBase = () =>
    baseline({
      suppressions: 1,
      boundaries: { "no-throw": { "app/x.ts": "tRPC contract" } },
      debt: { "no-throw": { "app/a.ts": 2 }, "no-other": {} },
    });

  it.each([
    ["a count raised by hand", baseline({ ...atBase(), debt: { "no-throw": { "app/a.ts": 3 }, "no-other": {} } }), "is 3, and the branch this merges into has 2"],
    ["a new debt entry under an existing rule", baseline({ ...atBase(), debt: { "no-throw": { "app/a.ts": 2 }, "no-other": { "app/b.ts": 1 } } }), 'debt["no-other"]["app/b.ts"] is 1, and the branch this merges into has 0'],
    ["a new boundary", baseline({ ...atBase(), boundaries: { "no-throw": { "app/x.ts": "tRPC contract", "app/y.ts": "because" } } }), 'boundaries["no-throw"]["app/y.ts"] is new'],
    ["an entry moved from debt to boundaries", baseline({ ...atBase(), boundaries: { "no-throw": { "app/x.ts": "tRPC contract", "app/a.ts": "now a boundary" } }, debt: { "no-throw": {}, "no-other": {} } }), 'boundaries["no-throw"]["app/a.ts"] is new'],
    ["a raised suppressions total", baseline({ ...atBase(), suppressions: 2 }), "`suppressions` is 2, and the branch this merges into has 1"],
  ])("flags %s as baseline-grew", (_name, head, message) => {
    const found = compareWithBase(atBase(), head);

    expect(found).toHaveLength(1);
    expect(found[0]?.rule).toBe("baseline-grew");
    expect(found[0]?.message).toContain(message);
  });

  it.each([
    ["a lower count", baseline({ ...atBase(), debt: { "no-throw": { "app/a.ts": 1 }, "no-other": {} } })],
    ["a deleted debt entry and a deleted boundary", baseline({ suppressions: 1, boundaries: {}, debt: { "no-throw": {}, "no-other": {} } })],
    ["a lower suppressions total", baseline({ ...atBase(), suppressions: 0 })],
    ["an equal file", atBase()],
  ])("accepts %s", (_name, head) => {
    expect(compareWithBase(atBase(), head)).toEqual([]);
  });

  it("accepts any entry under a rule whose key is absent from the base's debt, since that rule is new on this branch", () => {
    const head = baseline({
      ...atBase(),
      boundaries: { "no-throw": { "app/x.ts": "tRPC contract" }, "brand-new": { "app/d.ts": "owner's call" } },
      debt: { "no-throw": { "app/a.ts": 2 }, "no-other": {}, "brand-new": { "app/c.ts": 4 } },
    });

    expect(compareWithBase(atBase(), head)).toEqual([]);
  });
});

describe("baselineSize", () => {
  it("sums the debt counts rather than counting entries, and counts one per boundary file", () => {
    const size = baselineSize(
      baseline({
        boundaries: { "no-throw": { "app/x.ts": "a", "app/y.ts": "b" }, "no-other": { "app/z.ts": "c" } },
        debt: { "no-throw": { "app/a.ts": 2, "app/b.ts": 3 }, "no-other": { "app/c.ts": 1 } },
      })
    );

    expect(size).toEqual({ entries: 3, debt: 6, boundaries: 3 });
  });
});

describe("lowerBaseline", () => {
  const baseBaseline = () =>
    baseline({
      suppressions: 3,
      boundaries: { "no-bad": { "app/edge.ts": "framework contract", "app/gone.ts": "framework contract" } },
      debt: { "no-bad": { "app/a.ts": 3, "app/clean.ts": 2, "app/over.ts": 1 }, other: {} },
    });
  const tree = () =>
    ran(
      [
        finding("no-bad", "app/a.ts"),
        finding("no-bad", "app/edge.ts"),
        finding("no-bad", "app/over.ts", 1),
        finding("no-bad", "app/over.ts", 2),
        finding("no-bad", "app/new.ts"),
      ],
      1
    );

  it("lowers a count to what the code holds, deletes an entry for a clean file and a boundary that excuses nothing, and lowers the suppression total", () => {
    const after = lowerBaseline(baseBaseline(), tree());

    expect(after.debt["no-bad"]).toMatchObject({ "app/a.ts": 1 });
    expect(after.debt["no-bad"]).not.toHaveProperty("app/clean.ts");
    expect(after.boundaries["no-bad"]).toEqual({ "app/edge.ts": "framework contract" });
    expect(after.suppressions).toBe(1);
  });

  it("refuses to raise a count the code has outgrown, so the new finding still fails the gate", () => {
    expect(lowerBaseline(baseBaseline(), tree()).debt["no-bad"]?.["app/over.ts"]).toBe(1);
  });

  it("refuses to add an entry for a file with new findings and no debt", () => {
    expect(lowerBaseline(baseBaseline(), tree()).debt["no-bad"]).not.toHaveProperty("app/new.ts");
  });

  it("refuses to raise the suppression total when the code holds more markers than allowed", () => {
    expect(lowerBaseline(baseline({ suppressions: 1 }), ran([], 4)).suppressions).toBe(1);
  });

  it("keeps a rule's key when its last entry goes, since the key is how a rule is known at the base", () => {
    const after = lowerBaseline(baseline({ debt: { "no-bad": { "app/clean.ts": 1 }, other: {} } }), ran([]));

    expect(after.debt).toEqual({ "no-bad": {}, other: {} });
  });

  it("lowers a weighted entry to the new weight and never raises it, so a long file's recorded length only goes down", () => {
    const recorded = baseline({ debt: { "no-bad": { "app/long.ts": 1000 }, other: {} } });

    expect(lowerBaseline(recorded, ran([{ ...finding("no-bad", "app/long.ts"), weight: 990 }])).debt["no-bad"]).toEqual({ "app/long.ts": 990 });
    expect(lowerBaseline(recorded, ran([{ ...finding("no-bad", "app/long.ts"), weight: 1010 }])).debt["no-bad"]).toEqual({ "app/long.ts": 1000 });
  });

  it("never grows against the baseline it started from, whatever the code holds", () => {
    expect(compareWithBase(baseBaseline(), lowerBaseline(baseBaseline(), tree()))).toEqual([]);
  });
});
