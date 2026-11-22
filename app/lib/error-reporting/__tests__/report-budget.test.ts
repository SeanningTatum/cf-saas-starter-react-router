import { describe, expect, it } from "vitest";
import { makeReportBudget } from "../report-budget";

const spend = (take: (nowMs: number) => boolean, times: number, nowMs: number) =>
  Array.from({ length: times }, () => take(nowMs));

describe("makeReportBudget", () => {
  it("allows every take up to the limit, so that a quiet page never loses a report", () => {
    const budget = makeReportBudget({ limit: 3, windowMs: 1000 });
    expect(spend(budget.take, 3, 0)).toEqual([true, true, true]);
  });

  it("refuses once the limit is spent in the window, so that a flood cannot reach the reporter", () => {
    const budget = makeReportBudget({ limit: 2, windowMs: 1000 });
    spend(budget.take, 2, 0);
    expect(budget.take(500)).toBe(false);
    expect(budget.take(999)).toBe(false);
  });

  it("opens again in the next window, so that one burst does not block reports for good", () => {
    const budget = makeReportBudget({ limit: 1, windowMs: 1000 });
    expect(budget.take(0)).toBe(true);
    expect(budget.take(1)).toBe(false);
    expect(budget.take(1000)).toBe(true);
    expect(budget.take(1001)).toBe(false);
  });

  it("stays shut when the clock goes backwards, so that clock skew cannot reset a spent budget", () => {
    const budget = makeReportBudget({ limit: 1, windowMs: 1000 });
    expect(budget.take(5000)).toBe(true);
    expect(budget.take(100)).toBe(false);
    expect(budget.take(-10_000)).toBe(false);
  });
});
