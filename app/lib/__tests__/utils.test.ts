import { describe, it, expect } from "vitest";
import { cn, getInitials } from "../utils";

describe("getInitials", () => {
  it("takes first letter of first two words", () => {
    expect(getInitials("Jane Doe")).toBe("JD");
  });

  it("caps at two characters for long names", () => {
    expect(getInitials("Anna Maria van Beek")).toBe("AM");
  });

  it("handles single-word names", () => {
    expect(getInitials("admin")).toBe("A");
  });

  it("ignores extra whitespace between words", () => {
    expect(getInitials("Jane  Doe")).toBe("JD");
  });

  it("returns empty string for empty input", () => {
    expect(getInitials("")).toBe("");
  });
});

describe("cn", () => {
  it("merges class names from arguments", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("ignores falsy values", () => {
    expect(cn("a", null, undefined, false, "b")).toBe("a b");
  });

  it("collapses tailwind conflicts (later wins)", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("supports object and array forms via clsx", () => {
    expect(cn({ a: true, b: false }, ["c"])).toBe("a c");
  });

  it("returns empty string when no inputs", () => {
    expect(cn()).toBe("");
  });
});
