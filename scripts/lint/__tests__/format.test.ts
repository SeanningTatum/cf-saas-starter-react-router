import { describe, expect, it } from "vitest";
import { BASELINE_CHECKS, baselineFinding } from "../baseline";
import { FINDING_LINE } from "../constants";
import { formatFinding } from "../format";
import type { Finding } from "../types";

const found = (overrides: Partial<Finding> = {}): Finding => ({
  rule: "no-throw",
  file: "app/lib/x.ts",
  line: 12,
  message: "`throw` outside the Effect error channel",
  fix: "return `Effect.fail(…)`",
  ...overrides,
});

describe("formatFinding", () => {
  it("prints path:line rule-id: what. Do this instead: fix.", () => {
    expect(formatFinding(found())).toBe(
      "app/lib/x.ts:12 no-throw: `throw` outside the Effect error channel. Do this instead: return `Effect.fail(…)`."
    );
  });

  it("appends See <example>. when the rule names one", () => {
    expect(formatFinding(found({ example: "app/repositories/bucket.ts" }))).toBe(
      "app/lib/x.ts:12 no-throw: `throw` outside the Effect error channel. Do this instead: return `Effect.fail(…)`. See app/repositories/bucket.ts."
    );
  });

  it("does not double a trailing full stop or keep trailing space in the message or the fix", () => {
    const plain = formatFinding(found());

    expect(formatFinding(found({ message: "`throw` outside the Effect error channel.", fix: "return `Effect.fail(…)`. " }))).toBe(plain);
  });

  it.each([
    ["a plain finding", found()],
    ["a finding with an example", found({ example: "app/repositories/bucket.ts" })],
    ["a finding whose message and fix end in a stop", found({ message: "x.", fix: "y." })],
    ...Object.values(BASELINE_CHECKS).map((check): [string, Finding] => [
      `the default ${check.id} finding`,
      baselineFinding(check, "the baseline says something"),
    ]),
  ])("keeps %s in the house shape that FINDING_LINE matches", (_name, entry) => {
    expect(formatFinding(entry)).toMatch(FINDING_LINE);
  });
});
