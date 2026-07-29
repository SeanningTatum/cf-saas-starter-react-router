import { readFileSync } from "node:fs";
import type { GoldenCase } from "./graders";

/**
 * promptfoo test adapter: maps the canonical golden.jsonl into promptfoo
 * test cases. The raw golden case rides along in metadata so
 * assert-golden.ts can grade expected / must_not with the same deterministic
 * ladder the Vitest contract tests use.
 */
const cases: GoldenCase[] = readFileSync(
  new URL("./golden.jsonl", import.meta.url),
  "utf8"
)
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

export default cases.map((c) => ({
  vars: { input: c.input },
  metadata: { golden: c },
  assert: [{ type: "javascript", value: "file://assert-golden.ts" }],
}));
