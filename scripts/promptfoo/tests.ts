import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Generic promptfoo test adapter for any prompt module. PROMPT_MODULE_DIR
 * (set by scripts/eval-prompt.sh) points at app/lib/ai/prompts/<name>.
 * Maps the module's golden.jsonl into promptfoo test cases; the raw golden
 * case rides along in metadata so assert-golden.ts can grade with the same
 * deterministic ladder the Vitest contract tests use.
 */
const moduleDir = process.env.PROMPT_MODULE_DIR;
if (!moduleDir) {
  throw new Error("PROMPT_MODULE_DIR is not set — run via scripts/eval-prompt.sh");
}

const cases = readFileSync(resolve(moduleDir, "golden.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

export default cases.map((c) => ({
  vars: { input: c.input },
  metadata: { golden: c },
  assert: [{ type: "javascript", value: "file://assert-golden.ts" }],
}));
