import { describe, expect, it } from "vitest";
import { clip, isObject } from "../text";

describe("clip", () => {
  it("cuts at the cap and leaves shorter text whole, so a capped field is never longer than its cap", () => {
    expect(clip("abcdef", 3)).toBe("abc");
    expect(clip("ab", 3)).toBe("ab");
  });
});

describe("isObject", () => {
  it("refuses null and primitives, so a property read on a thrown null cannot crash the reporter", () => {
    expect(isObject(null)).toBe(false);
    expect(isObject("boom")).toBe(false);
    expect(isObject(undefined)).toBe(false);
    expect(isObject({})).toBe(true);
    expect(isObject(new Error("x"))).toBe(true);
  });
});
