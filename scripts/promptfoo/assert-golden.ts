import { resolve } from "node:path";

/**
 * Generic promptfoo javascript assertion for any prompt module. Loads the
 * module's own gradeCase (PROMPT_MODULE_DIR, set by eval-prompt.sh) so the
 * live gate uses exactly the deterministic ladder the Vitest contract tests
 * use — the model under test never grades itself.
 */
const moduleDir = process.env.PROMPT_MODULE_DIR;
if (!moduleDir) {
  throw new Error("PROMPT_MODULE_DIR is not set — run via scripts/eval-prompt.sh");
}
const { gradeCase } = await import(resolve(moduleDir, "graders.ts"));

export default function assertGolden(
  output: string,
  context: { test: { metadata: { golden: unknown } } }
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
