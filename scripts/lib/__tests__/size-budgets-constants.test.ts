import { describe, expect, it } from "vitest";
import { BUDGETS_PATH, PAGE_JS_LABEL_PATTERN, RATCHET_SKIPPED } from "../size-budgets-constants";
import { routeLabel } from "../size-constants";

describe("size-budgets-constants", () => {
  it("reads the page path out of the label the size table prints, and ignores a CSS row", () => {
    expect(routeLabel("/admin/users", "js").match(PAGE_JS_LABEL_PATTERN)?.[1]).toBe("/admin/users");
    expect(routeLabel("/admin/users", "css").match(PAGE_JS_LABEL_PATTERN)).toBeNull();
  });

  it("names the file and the ref when the base has no budget file", () => {
    expect(RATCHET_SKIPPED("origin/main")).toBe(`${BUDGETS_PATH} does not exist on origin/main, so there is no budget to hold the line against.`);
  });
});
