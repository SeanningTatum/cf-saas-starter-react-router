import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Schema } from "effect";
import {
  AdminInsightsInput,
  AdminInsightsOutput,
} from "../prompt";
import {
  gradeCase,
  gradeExpected,
  gradeMustNot,
  gradeProgrammatic,
  gradeSchema,
  parseMustNot,
  type GoldenCase,
} from "../graders";

const cases: GoldenCase[] = readFileSync(
  new URL("../golden.jsonl", import.meta.url),
  "utf8"
)
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

const decodeInput = Schema.decodeUnknownSync(AdminInsightsInput);
const decodePartialOutput = Schema.decodeUnknownSync(
  Schema.partial(AdminInsightsOutput)
);

// --- Golden set integrity (static gates — no live model calls) --------------

describe("golden set integrity", () => {
  it("has at least 20 cases (below that, a pass rate is noise)", () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
  });

  it("has at least 5 adversarial cases", () => {
    expect(
      cases.filter((c) => c.tags.includes("adversarial")).length
    ).toBeGreaterThanOrEqual(5);
  });

  it("every case has a unique id", () => {
    const ids = cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every case uses only the three mandatory buckets", () => {
    for (const c of cases) {
      expect(c.tags.length).toBeGreaterThan(0);
      for (const tag of c.tags) {
        expect(["happy", "edge", "adversarial"]).toContain(tag);
      }
    }
  });

  it("every case input satisfies AdminInsightsInput", () => {
    for (const c of cases) {
      expect(() => decodeInput(c.input), c.id).not.toThrow();
    }
  });

  it("every expected block satisfies the partial output schema", () => {
    for (const c of cases) {
      if (c.expected) {
        expect(() => decodePartialOutput(c.expected), c.id).not.toThrow();
      }
    }
  });

  it("every must_not expression parses", () => {
    for (const c of cases) {
      for (const expr of c.must_not ?? []) {
        expect(() => parseMustNot(expr), `${c.id}: ${expr}`).not.toThrow();
      }
    }
  });
});

// --- Grader unit tests (synthetic outputs, hand-written) --------------------

const validOutput = {
  headline: "Signups are steady with 38 new users this week",
  trends: [
    { label: "Signups", direction: "flat", detail: "8-11 per period" },
  ],
  suggestedActions: ["Review onboarding drop-off"],
  dataQuality: "sufficient",
} as const;

describe("gradeSchema", () => {
  it("passes a valid output", () => {
    expect(gradeSchema(validOutput)).toEqual([]);
  });

  it("fails an output missing a required field", () => {
    const { headline: _h, ...noHeadline } = validOutput;
    expect(gradeSchema(noHeadline)[0]?.grader).toBe("schema");
  });

  it("fails an output violating an enum", () => {
    expect(
      gradeSchema({ ...validOutput, dataQuality: "great" })[0]?.grader
    ).toBe("schema");
  });
});

describe("gradeExpected", () => {
  it("passes when labeled fields match", () => {
    expect(
      gradeExpected(validOutput, { dataQuality: "sufficient" })
    ).toEqual([]);
  });

  it("fails with a precise message on mismatch", () => {
    const failures = gradeExpected(validOutput, { dataQuality: "sparse" });
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain("dataQuality");
  });
});

describe("gradeProgrammatic", () => {
  const zeroInput = decodeInput({
    stats: {
      totalUsers: 0,
      verifiedUsers: 0,
      bannedUsers: 0,
      adminUsers: 0,
      verificationRate: 0,
    },
    growth: [],
    recentSignups7d: 0,
  });

  it("requires dataQuality sparse when totalUsers is 0", () => {
    expect(
      gradeProgrammatic(validOutput, zeroInput)[0]?.grader
    ).toBe("programmatic");
  });

  it("passes when totalUsers is 0 and dataQuality is sparse", () => {
    expect(
      gradeProgrammatic({ ...validOutput, dataQuality: "sparse" }, zeroInput)
    ).toEqual([]);
  });
});

describe("gradeMustNot", () => {
  it("fails when a forbidden statement holds", () => {
    const failures = gradeMustNot(validOutput, ["headline contains steady"]);
    expect(failures[0]?.message).toContain("headline contains steady");
  });

  it("passes when no forbidden statement holds", () => {
    expect(
      gradeMustNot(validOutput, [
        "headline contains campaign",
        "dataQuality == \"sparse\"",
      ])
    ).toEqual([]);
  });

  it("supports != and not_contains", () => {
    expect(gradeMustNot(validOutput, ["dataQuality != \"sufficient\""])).toEqual([]);
    expect(
      gradeMustNot(validOutput, ["headline not_contains steady"])
    ).toHaveLength(0);
  });

  it("treats an absent field as satisfying not_contains (violation)", () => {
    // Logical negation of contains: undefined trivially does not contain X.
    expect(
      gradeMustNot(validOutput, ["missingField not_contains x"])
    ).toHaveLength(1);
  });
});

describe("parseMustNot", () => {
  it("parses path, op, and JSON value", () => {
    expect(parseMustNot('dataQuality == "sparse"')).toEqual({
      path: "dataQuality",
      op: "==",
      value: "sparse",
    });
  });

  it("treats a non-JSON value as a raw string", () => {
    expect(parseMustNot("headline contains campaign")).toEqual({
      path: "headline",
      op: "contains",
      value: "campaign",
    });
  });

  it("throws on garbage", () => {
    expect(() => parseMustNot("no operator here")).toThrow();
  });
});

describe("gradeCase ladder", () => {
  it("short-circuits on schema failure before checking expected", () => {
    const failures = gradeCase({ bogus: true }, {
      id: "x",
      tags: ["happy"],
      input: {},
      expected: { dataQuality: "sufficient" },
    });
    expect(failures.map((f) => f.grader)).toEqual(["schema"]);
  });

  it("runs expected before must_not", () => {
    const failures = gradeCase(validOutput, {
      id: "x",
      tags: ["happy"],
      input: {},
      expected: { dataQuality: "sparse" },
      must_not: ["headline contains steady"],
    });
    expect(failures.map((f) => f.grader)).toEqual(["expected"]);
  });
});
