import { Either } from "effect";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { breaches, median, metricsOf, parseLimits, renderLighthouse, summarize, widestSpread, type Limits, type RefResult } from "../lighthouse-report";

const lhr = (score: number, lcp: number, tbt: number, cls: number): string =>
  JSON.stringify({
    categories: { performance: { score } },
    audits: {
      "largest-contentful-paint": { numericValue: lcp },
      "total-blocking-time": { numericValue: tbt },
      "cumulative-layout-shift": { numericValue: cls },
    },
  });

const LIMITS: Limits = { minScore: 90, maxLcpMs: 2500, maxTbtMs: 200, maxCls: 0.1 };
const m = (score: number, lcp: number, tbt: number, cls: number) => ({ score, lcp, tbt, cls });

describe("reading a Lighthouse report", () => {
  it("takes the performance score as 0 to 100 and LCP, TBT and CLS from their audits", () => {
    expect(metricsOf(lhr(0.976, 1816.7, 12.4, 0.0021))).toEqual(Either.right(m(98, 1816.7, 12.4, 0.0021)));
  });

  it("refuses a report with no performance category: a runtime error report must not read as score 0", () => {
    expect(Either.isLeft(metricsOf(JSON.stringify({ categories: {}, audits: {} })))).toBe(true);
    expect(Either.isLeft(metricsOf(""))).toBe(true);
  });

  it("reads the checked-in limits file", () => {
    const text = readFileSync(join(__dirname, "..", "..", "..", ".github", "lighthouse-limits.json"), "utf8");
    expect(Either.isRight(parseLimits(text))).toBe(true);
    expect(Either.isLeft(parseLimits('{"minScore":90}'))).toBe(true);
  });
});

describe("median and spread", () => {
  it("takes the middle of an odd count and the mean of the two middles of an even one", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("summarizes each metric on its own: the median score and the median LCP may come from different runs", () => {
    const page = summarize("/", [m(90, 2000, 10, 0), m(95, 1500, 50, 0.1), m(80, 1800, 0, 0.05)]);
    expect(page.median).toEqual(m(90, 1800, 10, 0.05));
    expect(page.spread).toEqual(m(15, 500, 50, 0.1));
  });

  it("the widest spread is the largest max − min per metric over every page", () => {
    const a = summarize("/a", [m(90, 1000, 0, 0), m(92, 1100, 0, 0)]);
    const b = summarize("/b", [m(70, 1000, 30, 0.01), m(71, 1600, 0, 0)]);
    expect(widestSpread([a, b])).toEqual(m(2, 600, 30, 0.01));
  });
});

describe("the Lighthouse section of the comment", () => {
  const head: RefResult = { ref: "HEAD", pages: [summarize("/", [m(97, 1820, 10, 0)]), summarize("/dashboard", [m(85, 2600, 250, 0.2)])] };
  const base: RefResult = { ref: "origin/staging", pages: [summarize("/", [m(98, 1800, 0, 0)])] };

  it("lists every metric past a limit, and nothing for a page inside them", () => {
    expect(breaches(head, LIMITS)).toEqual([
      "`/dashboard` performance score 85 is below 90",
      "`/dashboard` LCP 2,600 ms is above 2,500 ms",
      "`/dashboard` TBT 250 ms is above 200 ms",
      "`/dashboard` CLS 0.200 is above 0.100",
    ]);
  });

  it("puts the base beside this PR, shows a page the base lacks on its own, and states spread, limits and warnings", () => {
    const text = renderLighthouse(head, base, LIMITS);
    expect(text.split("\n").slice(0, 6)).toEqual([
      "## Lighthouse (mobile, median of 3 runs)",
      "",
      "| Page | Score | LCP | TBT | CLS |",
      "|---|---:|---:|---:|---:|",
      "| `/` | 98 → 97 | 1,800 ms → 1,820 ms | 0 ms → 10 ms | 0.000 → 0.000 |",
      "| `/dashboard` | 85 | 2,600 ms | 250 ms | 0.200 |",
    ]);
    expect(text).toContain("Each cell reads `origin/staging` → this PR.");
    expect(text).toContain("Limits in `.github/lighthouse-limits.json` (warn only): score ≥ 90, LCP ≤ 2,500 ms, TBT ≤ 200 ms, CLS ≤ 0.100.");
    expect(text).toContain("- Warning: `/dashboard` TBT 250 ms is above 200 ms");
  });

  it("says no page is past a limit when none is, and names the ref when there is no base", () => {
    const text = renderLighthouse({ ref: "HEAD", pages: [summarize("/", [m(99, 900, 0, 0)])] }, undefined, LIMITS);
    expect(text).toContain("Measured `HEAD`.");
    expect(text).toContain("No page is past a limit.");
  });
});
