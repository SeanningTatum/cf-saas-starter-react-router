import { describe, expect, it } from "vitest";
import { healthReport, makeHealthMemo } from "../health-check";

const TTL = 5_000;

describe("makeHealthMemo", () => {
  it("has nothing before the first write, so that the first request always checks the database", () => {
    expect(makeHealthMemo(TTL).read(1_000)).toBeUndefined();
  });

  it("returns the last answer inside the window and nothing once it has passed, so that a stale up never hides a database that went down", () => {
    const memo = makeHealthMemo(TTL);
    memo.write(10_000, true);
    expect(memo.read(10_000)).toBe(true);
    expect(memo.read(10_000 + TTL - 1)).toBe(true);
    expect(memo.read(10_000 + TTL)).toBeUndefined();
  });

  it("keeps a down answer for the window too, so that an outage does not send every request to the database", () => {
    const memo = makeHealthMemo(TTL);
    memo.write(0, false);
    expect(memo.read(1)).toBe(false);
  });

  it("ignores a clock that went backwards, so that a skewed time cannot pin an old answer forever", () => {
    const memo = makeHealthMemo(TTL);
    memo.write(10_000, true);
    expect(memo.read(9_999)).toBeUndefined();
  });
});

describe("healthReport", () => {
  it("names up and down and carries the release, so that the body is the same shape either way", () => {
    expect(healthReport(true, "v1.2.3")).toEqual({ status: "up", release: "v1.2.3" });
    expect(healthReport(false, "abc123")).toEqual({ status: "down", release: "abc123" });
  });
});
