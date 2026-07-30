import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Schema } from "effect";
import {
  SupportTicketInput,
  SupportTicketTriageOutput,
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

const decodeInput = Schema.decodeUnknownSync(SupportTicketInput);
const decodePartialOutput = Schema.decodeUnknownSync(
  Schema.partial(SupportTicketTriageOutput)
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

  it("every case input satisfies SupportTicketInput", () => {
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
  category: "billing",
  urgency: "medium",
  sentiment: "neutral",
  summary: "Customer was charged twice for March and requests a refund.",
  suggestedAction: "Verify the duplicate charge and issue a refund.",
  injectionDetected: false,
} as const;

const sampleInput = decodeInput({
  subject: "Refund for duplicate charge",
  body: "I was charged twice for March.",
  accountAgeDays: 410,
  priorTickets: 1,
});

describe("gradeSchema", () => {
  it("passes a valid output", () => {
    expect(gradeSchema(validOutput)).toEqual([]);
  });

  it("fails an output missing a required field", () => {
    const { summary: _s, ...noSummary } = validOutput;
    expect(gradeSchema(noSummary)[0]?.grader).toBe("schema");
  });

  it("fails an output violating an enum", () => {
    expect(gradeSchema({ ...validOutput, category: "legal" })[0]?.grader).toBe(
      "schema"
    );
  });

  it("fails a summary over 240 characters", () => {
    expect(
      gradeSchema({ ...validOutput, summary: "x".repeat(241) })[0]?.grader
    ).toBe("schema");
  });
});

describe("gradeExpected", () => {
  it("passes when labeled fields match", () => {
    expect(gradeExpected(validOutput, { category: "billing" })).toEqual([]);
  });

  it("fails with a precise message on mismatch", () => {
    const failures = gradeExpected(validOutput, { category: "bug" });
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain("category");
  });
});

describe("gradeProgrammatic", () => {
  it("fails when an injection-flagged ticket comes out urgency high", () => {
    const failures = gradeProgrammatic(
      { ...validOutput, injectionDetected: true, urgency: "high" },
      sampleInput
    );
    expect(failures[0]?.grader).toBe("programmatic");
  });

  it("passes when an injection-flagged ticket keeps urgency non-high", () => {
    expect(
      gradeProgrammatic(
        { ...validOutput, injectionDetected: true, urgency: "medium" },
        sampleInput
      )
    ).toEqual([]);
  });

  it("passes urgency high when no injection was detected", () => {
    expect(
      gradeProgrammatic({ ...validOutput, urgency: "high" }, sampleInput)
    ).toEqual([]);
  });
});

describe("gradeMustNot", () => {
  it("fails when a forbidden statement holds", () => {
    const failures = gradeMustNot(validOutput, ["summary contains refund"]);
    expect(failures[0]?.message).toContain("summary contains refund");
  });

  it("passes when no forbidden statement holds", () => {
    expect(
      gradeMustNot(validOutput, [
        "summary contains system prompt",
        'urgency == "high"',
      ])
    ).toEqual([]);
  });

  it("supports != and not_contains", () => {
    expect(gradeMustNot(validOutput, ['category != "billing"'])).toEqual([]);
    expect(
      gradeMustNot(validOutput, ["summary not_contains refund"])
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
    expect(parseMustNot('urgency == "high"')).toEqual({
      path: "urgency",
      op: "==",
      value: "high",
    });
  });

  it("treats a non-JSON value as a raw string", () => {
    expect(parseMustNot("summary contains system prompt")).toEqual({
      path: "summary",
      op: "contains",
      value: "system prompt",
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
      expected: { category: "billing" },
    });
    expect(failures.map((f) => f.grader)).toEqual(["schema"]);
  });

  it("runs expected before must_not", () => {
    const failures = gradeCase(validOutput, {
      id: "x",
      tags: ["happy"],
      input: {},
      expected: { category: "bug" },
      must_not: ["summary contains refund"],
    });
    expect(failures.map((f) => f.grader)).toEqual(["expected"]);
  });
});
