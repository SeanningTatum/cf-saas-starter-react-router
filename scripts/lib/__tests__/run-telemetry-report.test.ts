import { describe, expect, it } from "vitest";
import { emptyRunFile, mergeLedger, type LedgerCall, type RunFile } from "../run-telemetry";
import { statsLines, summaryLines } from "../run-telemetry-report";

const call = (over: Partial<LedgerCall> = {}): LedgerCall => ({
  label: "audit",
  phase: "Audit",
  agent: "ticket-auditor",
  model: "",
  attempt: 1,
  outcome: "ok",
  verdict: "ready",
  ...over,
});

const LEDGER = [
  call(),
  call({ label: "build:1", phase: "Build", agent: "backend-builder", outcome: "empty", verdict: "" }),
  call({ label: "build:1", phase: "Build", agent: "backend-builder", attempt: 2 }),
];

const recorded = (slug: string): RunFile => mergeLedger(emptyRunFile(slug), "ship-feature", LEDGER);

const ingested = (slug: string): RunFile => {
  const file = recorded(slug);
  const calls = file.workflows["ship-feature"]?.calls ?? [];
  return {
    ...file,
    workflows: { "ship-feature": { calls: calls.map((c) => ({ ...c, tokens: { in: 100, out: 40, cache_read: 0, cache_write: 0 }, seconds: 5, ran_model: "m" })) } },
  };
};

const rowFor = (lines: string[], name: string): string => lines.find((l) => l.trimStart().startsWith(name)) ?? "";

describe("summaryLines", () => {
  it("prints n/a for tokens and seconds until transcripts were read: a zero would read as a free run", () => {
    const lines = summaryLines(recorded("demo"), false);
    expect(rowFor(lines, "total")).toMatch(/n\/a\s+n\/a\s+n\/a\s*$/);
    expect(lines.join("\n")).not.toMatch(/\b0\.0\b/);
  });

  it("counts calls, retries and failures by phase and sums what was read", () => {
    const lines = summaryLines(ingested("demo"), false);
    expect(rowFor(lines, "Build").split(/\s+/).filter(Boolean)).toEqual(["Build", "2", "1", "1", "200", "80", "10.0"]);
    expect(rowFor(lines, "total").split(/\s+/).filter(Boolean)).toEqual(["total", "3", "1", "1", "300", "120", "15.0"]);
  });

  it("gives a GitHub table in markdown mode: the PR body shows it", () => {
    const lines = summaryLines(ingested("demo"), true);
    expect(lines.some((l) => /^\|\s*-+/.test(l))).toBe(true);
    expect(lines.some((l) => l.startsWith("|") && l.includes("Build"))).toBe(true);
  });
});

describe("statsLines", () => {
  it("names the slowest phase and ranks agents by failure rate, worst first: the two questions the command exists to answer", () => {
    const text = statsLines([ingested("demo"), ingested("other")], false).join("\n");
    expect(text).toContain("ship-feature / Build");
    expect(text.indexOf("backend-builder")).toBeLessThan(text.indexOf("ticket-auditor"));
    expect(text).toMatch(/backend-builder\s+2\s+4\s+50\.0%/);
  });

  it("says n/a for the slowest phase when no call has a time yet", () => {
    expect(statsLines([recorded("demo")], false).join("\n")).toMatch(/Slowest phase\s*\n.*n\/a/);
  });
});
