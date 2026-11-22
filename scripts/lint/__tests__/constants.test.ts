import { describe, expect, it } from "vitest";
import { E2E_SPEC, FINDING_LINE, RULE_ID, TEST_PATH } from "../constants";

describe("FINDING_LINE", () => {
  it.each([
    ["app/a.ts:3 no-throw: throw found. Do this instead: fail with a tagged error.", true],
    ["app/a.ts:3 no-throw: throw found. Do this instead: fail with a tagged error. See app/lib/x.ts.", true],
    ["app/a.ts:3 no-throw: throw found.", false],
    ["app/a.ts:3 no-throw: throw found. Fix: fail with a tagged error.", false],
    ["app/a.ts no-throw: throw found. Do this instead: fail with a tagged error.", false],
  ])("%s is a finding line: %s", (line, expected) => {
    expect(FINDING_LINE.test(line)).toBe(expected);
  });
});

describe("RULE_ID", () => {
  it.each([
    ["no-throw", true],
    ["test-map", true],
    ["rule2", true],
    ["No-throw", false],
    ["1rule", false],
    ["rule-", false],
    ["rule--x", false],
    ["-rule", false],
  ])("%s is a rule id: %s", (id, expected) => {
    expect(RULE_ID.test(id)).toBe(expected);
  });
});

describe("TEST_PATH", () => {
  it.each([
    ["app/lib/__tests__/helper.ts", true],
    ["app/lib/x.test.ts", true],
    ["app/components/x.test.tsx", true],
    ["app/services/database.test-layer.ts", true],
    ["app/lib/latest.ts", false],
    ["app/lib/test.ts", false],
  ])("%s is a test path: %s", (path, expected) => {
    expect(TEST_PATH.test(path)).toBe(expected);
  });
});

describe("E2E_SPEC", () => {
  it.each([
    ["e2e/x.spec.ts", true],
    ["e2e/file-upload.paths.spec.ts", true],
    ["e2e/x.spec.tsx.bak", false],
    ["e2e/x.spec.tsx", false],
    ["e2e/helpers.ts", false],
  ])("%s is an e2e spec: %s", (path, expected) => {
    expect(E2E_SPEC.test(path)).toBe(expected);
  });
});
