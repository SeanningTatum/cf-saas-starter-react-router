import { describe, expect, it } from "vitest";
import { GH_ARGS, GIT_ARGS, SAFE_BRANCH_PATTERN, unsafeLine } from "../default-branch-constants";
import { SYMBOLIC_REF_ARGS } from "../migration-constants";

describe("default-branch-constants", () => {
  it("asks gh for the default branch name only, as one bare value", () => {
    expect(GH_ARGS).toEqual(["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"]);
  });

  it("reads origin/HEAD with the same arguments the migration gate uses: two spellings would drift", () => {
    expect(GIT_ARGS).toEqual([...SYMBOLIC_REF_ARGS]);
  });

  it("accepts plain branch names and refuses a leading dash or shell-active characters", () => {
    expect(SAFE_BRANCH_PATTERN.test("release/v3.0")).toBe(true);
    expect(SAFE_BRANCH_PATTERN.test("-rf")).toBe(false);
    expect(SAFE_BRANCH_PATTERN.test("a;b")).toBe(false);
    expect(SAFE_BRANCH_PATTERN.test("$(id)")).toBe(false);
  });

  it("quotes the refused name in its message, so odd characters are visible and inert", () => {
    expect(unsafeLine('x"y')).toContain(JSON.stringify('x"y'));
  });
});
