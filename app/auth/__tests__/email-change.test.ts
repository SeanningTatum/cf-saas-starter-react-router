import { describe, expect, it } from "vitest";
import { isEmailChange } from "../email-change";

describe("isEmailChange", () => {
  it.each([
    ["a new address", "b@x.test", true],
    ["the stored address", "a@x.test", false],
    ["no address at all", undefined, false],
    ["a null address, which is not the stored one", null, true],
  ])("%s -> %s", (_label, next, expected) => {
    expect(isEmailChange("a@x.test", next)).toBe(expected);
  });
});
