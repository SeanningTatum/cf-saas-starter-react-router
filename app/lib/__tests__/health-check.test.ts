import { describe, expect, it, vi } from "vitest";
import { healthReport, makeSharedCheck } from "../health-check";

const TTL = 5_000;

describe("makeSharedCheck", () => {
  it("runs the check on the first call and hands back its answer, so that the first request always asks the database", async () => {
    const check = vi.fn(() => Promise.resolve(true));
    expect(await makeSharedCheck(TTL).get(1_000, check)).toBe(true);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("reuses the answer inside the window and checks again once it has passed, so that a stale up never hides a database that went down", async () => {
    const shared = makeSharedCheck(TTL);
    const check = vi.fn(() => Promise.resolve(true));
    await shared.get(10_000, check);
    await shared.get(10_000 + TTL - 1, check);
    expect(check).toHaveBeenCalledTimes(1);
    await shared.get(10_000 + TTL, check);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("gives every caller that arrives while a check is running the same pending answer, so that a burst at the window's edge is one query, not one per request", async () => {
    const shared = makeSharedCheck(TTL);
    let finish: (up: boolean) => void = () => undefined;
    const check = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    const answers = [shared.get(0, check), shared.get(1, check), shared.get(2, check)];
    finish(true);
    expect(await Promise.all(answers)).toEqual([true, true, true]);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("keeps sharing a check that is still running after the window ends, so that a slow database never has several checks piled on it", async () => {
    const shared = makeSharedCheck(TTL);
    let finish: (up: boolean) => void = () => undefined;
    const slow = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    const first = shared.get(0, slow);
    const late = shared.get(TTL * 3, slow);
    expect(slow).toHaveBeenCalledTimes(1);
    finish(true);
    expect(await Promise.all([first, late])).toEqual([true, true]);
    void shared.get(TTL * 4, slow);
    expect(slow).toHaveBeenCalledTimes(2);
    finish(true);
  });

  it("keeps a down answer and a rejected check for the window as down, so that an outage or a broken runtime does not run, and report, once per request", async () => {
    const shared = makeSharedCheck(TTL);
    const check = vi.fn(() => Promise.reject(new Error("runtime did not build")));
    expect(await shared.get(0, check)).toBe(false);
    expect(await shared.get(1, check)).toBe(false);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("checks again when the clock went backwards, so that a skewed time cannot pin an old answer", async () => {
    const shared = makeSharedCheck(TTL);
    const check = vi.fn(() => Promise.resolve(true));
    await shared.get(10_000, check);
    await shared.get(9_999, check);
    expect(check).toHaveBeenCalledTimes(2);
  });
});

describe("healthReport", () => {
  it("names up and down and carries the release, so that the body is the same shape either way", () => {
    expect(healthReport(true, "v1.2.3")).toEqual({ status: "up", release: "v1.2.3" });
    expect(healthReport(false, "abc123")).toEqual({ status: "down", release: "abc123" });
  });
});
