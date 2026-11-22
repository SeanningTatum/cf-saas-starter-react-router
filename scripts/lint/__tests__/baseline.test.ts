import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { baselineSize, compareWithBase, parseBaseline } from "../baseline";
import { BASELINE_PATH, FINDING_LINE } from "../constants";
import { formatFinding } from "../format";
import { baseline } from "./fixtures";

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
      debt: { "no-throw": { "app/a.ts": 2 }, "no-zod": {} },
    });

  it.each([
    ["a count raised by hand", baseline({ ...atBase(), debt: { "no-throw": { "app/a.ts": 3 }, "no-zod": {} } }), "is 3, and the branch this merges into has 2"],
    ["a new debt entry under an existing rule", baseline({ ...atBase(), debt: { "no-throw": { "app/a.ts": 2 }, "no-zod": { "app/b.ts": 1 } } }), 'debt["no-zod"]["app/b.ts"] is 1, and the branch this merges into has 0'],
    ["a new boundary", baseline({ ...atBase(), boundaries: { "no-throw": { "app/x.ts": "tRPC contract", "app/y.ts": "because" } } }), 'boundaries["no-throw"]["app/y.ts"] is new'],
    ["an entry moved from debt to boundaries", baseline({ ...atBase(), boundaries: { "no-throw": { "app/x.ts": "tRPC contract", "app/a.ts": "now a boundary" } }, debt: { "no-throw": {}, "no-zod": {} } }), 'boundaries["no-throw"]["app/a.ts"] is new'],
    ["a raised suppressions total", baseline({ ...atBase(), suppressions: 2 }), "`suppressions` is 2, and the branch this merges into has 1"],
  ])("flags %s as baseline-grew", (_name, head, message) => {
    const found = compareWithBase(atBase(), head);

    expect(found).toHaveLength(1);
    expect(found[0]?.rule).toBe("baseline-grew");
    expect(found[0]?.message).toContain(message);
  });

  it.each([
    ["a lower count", baseline({ ...atBase(), debt: { "no-throw": { "app/a.ts": 1 }, "no-zod": {} } })],
    ["a deleted debt entry and a deleted boundary", baseline({ suppressions: 1, boundaries: {}, debt: { "no-throw": {}, "no-zod": {} } })],
    ["a lower suppressions total", baseline({ ...atBase(), suppressions: 0 })],
    ["an equal file", atBase()],
  ])("accepts %s", (_name, head) => {
    expect(compareWithBase(atBase(), head)).toEqual([]);
  });

  it("accepts any entry under a rule whose key is absent from the base's debt, since that rule is new on this branch", () => {
    const head = baseline({
      ...atBase(),
      boundaries: { "no-throw": { "app/x.ts": "tRPC contract" }, "brand-new": { "app/d.ts": "owner's call" } },
      debt: { "no-throw": { "app/a.ts": 2 }, "no-zod": {}, "brand-new": { "app/c.ts": 4 } },
    });

    expect(compareWithBase(atBase(), head)).toEqual([]);
  });
});

describe("baselineSize", () => {
  it("sums the debt counts rather than counting entries, and counts one per boundary file", () => {
    const size = baselineSize(
      baseline({
        boundaries: { "no-throw": { "app/x.ts": "a", "app/y.ts": "b" }, "no-zod": { "app/z.ts": "c" } },
        debt: { "no-throw": { "app/a.ts": 2, "app/b.ts": 3 }, "no-zod": { "app/c.ts": 1 } },
      })
    );

    expect(size).toEqual({ debt: 6, boundaries: 3 });
  });
});
