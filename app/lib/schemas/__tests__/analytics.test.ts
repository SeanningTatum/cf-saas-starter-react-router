import { describe, it, expect } from "vitest";
import { Schema } from "effect";
import {
  DateRangeInput,
  GetRecentSignupsCountInput,
} from "../analytics";

const decode = <A, I>(s: Schema.Schema<A, I>) => Schema.decodeUnknownEither(s);

describe("DateRangeInput", () => {
  it("accepts Date instances", () => {
    expect(
      decode(DateRangeInput)({
        startDate: new Date(),
        endDate: new Date(),
      })._tag
    ).toBe("Right");
  });
  it("rejects non-Date strings", () => {
    expect(
      decode(DateRangeInput)({
        startDate: "2024-01-01",
        endDate: "2024-01-02",
      })._tag
    ).toBe("Left");
  });
});

describe("GetRecentSignupsCountInput", () => {
  it("applies default of 7 days", () => {
    const result = Schema.decodeUnknownSync(GetRecentSignupsCountInput)({});
    expect(result.days).toBe(7);
  });
  it("rejects 0 days", () => {
    expect(decode(GetRecentSignupsCountInput)({ days: 0 })._tag).toBe("Left");
  });
  it("rejects > 365 days", () => {
    expect(
      decode(GetRecentSignupsCountInput)({ days: 400 })._tag
    ).toBe("Left");
  });
  it("accepts boundary values", () => {
    expect(decode(GetRecentSignupsCountInput)({ days: 1 })._tag).toBe("Right");
    expect(decode(GetRecentSignupsCountInput)({ days: 365 })._tag).toBe("Right");
  });
});
