import { Schema } from "effect";
import {
  AdminInsightsInput,
  AdminInsightsOutput,
  type AdminInsightsOutput as Output,
} from "./prompt";

/**
 * Deterministic graders for the admin-insights golden set — cheapest rungs
 * of the eval ladder (schema → field equality → programmatic → must_not).
 * Pure functions, no live model calls: Vitest covers them here, and
 * promptfoo's javascript assertion (`assert-golden.ts`) reuses the same
 * functions for live runs. Judges belong to the eval config, not this file.
 */

export interface GoldenCase {
  id: string;
  tags: readonly string[];
  input: unknown;
  expected?: Record<string, unknown>;
  must_not?: readonly string[];
  synthetic?: boolean;
}

export interface GradeFailure {
  grader: "schema" | "expected" | "programmatic" | "must_not";
  message: string;
}

/** Rung 1 — output satisfies the contract. */
export const gradeSchema = (output: unknown): GradeFailure[] => {
  const decoded = Schema.decodeUnknownEither(AdminInsightsOutput)(output);
  return decoded._tag === "Right"
    ? []
    : [{ grader: "schema", message: String(decoded.left) }];
};

/** Rung 2 — every labeled field matches (partial expectations allowed). */
export const gradeExpected = (
  output: Output,
  expected: Record<string, unknown>
): GradeFailure[] =>
  Object.entries(expected).flatMap(([key, want]) => {
    const got = (output as Record<string, unknown>)[key];
    return JSON.stringify(got) === JSON.stringify(want)
      ? []
      : [
          {
            grader: "expected" as const,
            message: `${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`,
          },
        ];
  });

/**
 * Rung 3 — input↔output invariants the schema cannot express.
 * Currently: an empty product must be reported as sparse.
 */
export const gradeProgrammatic = (
  output: Output,
  input: AdminInsightsInput
): GradeFailure[] => {
  const failures: GradeFailure[] = [];
  if (input.stats.totalUsers === 0 && output.dataQuality !== "sparse") {
    failures.push({
      grader: "programmatic",
      message: `totalUsers is 0 but dataQuality is "${output.dataQuality}" (must be "sparse")`,
    });
  }
  return failures;
};

// --- must_not mini-DSL -----------------------------------------------------
// "<dot.path> <op> <value>" — op ∈ == | != | contains | not_contains.
// A case FAILS when a must_not expression holds (the model got captured).

const OPS = ["not_contains", "contains", "==", "!="] as const;
type Op = (typeof OPS)[number];

export interface MustNotExpr {
  path: string;
  op: Op;
  value: unknown;
}

export const parseMustNot = (expr: string): MustNotExpr => {
  for (const op of OPS) {
    const idx = expr.indexOf(` ${op} `);
    if (idx > 0) {
      const rawValue = expr.slice(idx + op.length + 2).trim();
      let value: unknown;
      try {
        value = JSON.parse(rawValue);
      } catch {
        value = rawValue;
      }
      return { path: expr.slice(0, idx).trim(), op, value };
    }
  }
  throw new Error(`Unparseable must_not expression: ${expr}`);
};

const resolvePath = (obj: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>(
    (acc, key) =>
      acc !== null && typeof acc === "object"
        ? (acc as Record<string, unknown>)[key]
        : undefined,
    obj
  );

const holds = (expr: MustNotExpr, output: unknown): boolean => {
  const got = resolvePath(output, expr.path);
  switch (expr.op) {
    case "==":
      return JSON.stringify(got) === JSON.stringify(expr.value);
    case "!=":
      return JSON.stringify(got) !== JSON.stringify(expr.value);
    case "contains":
      return got !== undefined && String(got).includes(String(expr.value));
    case "not_contains":
      // Logical negation of `contains`: an absent field trivially does not
      // contain the value, so the expression holds (and is a violation).
      return got === undefined || !String(got).includes(String(expr.value));
  }
};

/** Rung 4 — adversarial guard: none of the forbidden statements may hold. */
export const gradeMustNot = (
  output: Output,
  mustNot: readonly string[]
): GradeFailure[] =>
  mustNot.flatMap((raw) => {
    const expr = parseMustNot(raw);
    return holds(expr, output)
      ? [
          {
            grader: "must_not" as const,
            message: `violated: ${raw}`,
          },
        ]
      : [];
  });

/** Full deterministic ladder for one case. Stops at the first failing rung. */
export const gradeCase = (
  output: unknown,
  golden: GoldenCase
): GradeFailure[] => {
  const schemaFailures = gradeSchema(output);
  if (schemaFailures.length > 0) return schemaFailures;

  const typed = output as Output;
  const expectedFailures = golden.expected
    ? gradeExpected(typed, golden.expected)
    : [];
  if (expectedFailures.length > 0) return expectedFailures;

  const inputDecoded = Schema.decodeUnknownEither(AdminInsightsInput)(
    golden.input
  );
  const programmaticFailures =
    inputDecoded._tag === "Right"
      ? gradeProgrammatic(typed, inputDecoded.right)
      : [];
  if (programmaticFailures.length > 0) return programmaticFailures;

  return golden.must_not ? gradeMustNot(typed, golden.must_not) : [];
};
