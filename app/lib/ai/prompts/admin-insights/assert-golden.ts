import { gradeCase, type GoldenCase } from "./graders";

/**
 * promptfoo javascript assertion. Reuses the deterministic grader ladder —
 * the model under test never grades itself. `context.test.metadata.golden`
 * is the raw golden case (see tests.ts).
 */
export default function assertGolden(
  output: string,
  context: { test: { metadata: { golden: GoldenCase } } }
) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return { pass: false, score: 0, reason: "response is not valid JSON" };
  }
  const failures = gradeCase(parsed, context.test.metadata.golden);
  if (failures.length === 0) {
    return { pass: true, score: 1, reason: "all deterministic graders passed" };
  }
  return {
    pass: false,
    score: 0,
    reason: failures.map((f) => `${f.grader}: ${f.message}`).join("; "),
  };
}
