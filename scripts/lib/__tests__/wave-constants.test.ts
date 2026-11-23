import { describe, expect, it } from "vitest";
import * as constants from "../wave-constants";
import { BRANCH_PATTERN, PR_VIEW_FIELDS, SHA_PATTERN, SLUG_PATTERN, THREADS_QUERY, USAGE_TEXT } from "../wave-constants";

describe("wave-constants", () => {
  it("the usage text names every verb, so a new verb cannot ship without telling the person how to call it", () => {
    const verbs = Object.entries(constants).flatMap(([key, value]) => (key.startsWith("VERB_") ? [String(value)] : []));
    expect(verbs).toHaveLength(13);
    for (const verb of verbs) expect(USAGE_TEXT).toContain(` ${verb} <slug>`);
  });

  it("the gate takes only a full 40-character lower-case sha, so a short or upper-case sha cannot be logged as the gated head", () => {
    expect(SHA_PATTERN.test("0123456789abcdef0123456789abcdef01234567")).toBe(true);
    expect(SHA_PATTERN.test("0123456789abcdef0123456789abcdef0123456")).toBe(false);
    expect(SHA_PATTERN.test("0123456789ABCDEF0123456789ABCDEF01234567")).toBe(false);
  });

  it("a branch name with `..` or a leading dash is refused, so it cannot reach gh as a range or a flag", () => {
    expect(BRANCH_PATTERN.test("v3/wave-2")).toBe(true);
    expect(BRANCH_PATTERN.test("release/v3.0")).toBe(true);
    expect(BRANCH_PATTERN.test("main..evil")).toBe(false);
    expect(BRANCH_PATTERN.test("--force")).toBe(false);
    expect(SLUG_PATTERN.test("wave-two")).toBe(true);
    expect(SLUG_PATTERN.test("../wave")).toBe(false);
  });

  it("gh is asked for every field the guard decodes, and the threads query takes the pr as an Int, so no guard read fails on a dropped field", () => {
    expect(PR_VIEW_FIELDS.split(",").sort()).toEqual(["baseRefName", "headRefOid", "mergeable", "state", "statusCheckRollup"]);
    expect(THREADS_QUERY).toContain("$pr:Int!");
    for (const field of ["isResolved", "login", "url"]) expect(THREADS_QUERY).toContain(field);
  });
});
