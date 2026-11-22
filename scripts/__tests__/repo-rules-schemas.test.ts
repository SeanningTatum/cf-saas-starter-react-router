import { Either, Schema } from "effect";
import { describe, it, expect } from "vitest";
import { Config, hasOldShape } from "../lib/repo-rules-schemas";

const ruleset = {
  name: "r",
  target: "branch",
  enforcement: "active",
  bypass_actors: [],
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
  rules: [],
};

describe("hasOldShape", () => {
  it("a file with only the old ruleset key is old, so the check can say to rename it", () => {
    expect(hasOldShape(JSON.stringify({ ruleset, environments: [] }))).toBe(true);
  });

  it("a file with rulesets is not old, even if it keeps a stray ruleset key", () => {
    expect(hasOldShape(JSON.stringify({ rulesets: [ruleset], ruleset, environments: [] }))).toBe(false);
  });

  it("text that is not JSON is not called old, so the schema error shows instead", () => {
    expect(hasOldShape("{ nope")).toBe(false);
  });
});

describe("Config", () => {
  const decode = (v: unknown) => Schema.decodeUnknownEither(Config)(v);

  it("accepts two rulesets", () => {
    expect(Either.isRight(decode({ rulesets: [ruleset, { ...ruleset, name: "s" }], environments: [] }))).toBe(true);
  });

  it("rejects an empty rulesets list, so a file with no rule cannot pass", () => {
    expect(Either.isLeft(decode({ rulesets: [], environments: [] }))).toBe(true);
  });
});
