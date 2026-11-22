import { describe, expect, it } from "vitest";
import { emptyRunFile, isValidSlug, ledgerChecksum, mergeLedger, parseLedger, parseRunFile, type LedgerCall } from "../run-telemetry";

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

const lineOf = (c: LedgerCall): string => JSON.stringify([c.label, c.phase, c.agent, c.model, c.attempt, c.outcome, c.verdict]);

const ledgerText = (calls: LedgerCall[]): string => {
  const lines = calls.map(lineOf);
  return [...lines, JSON.stringify({ calls: lines.length, check: ledgerChecksum(lines.join("\n")) })].join("\n");
};

describe("ledgerChecksum", () => {
  it("gives the published FNV-1a sums: a different sum here and in the workflow library would refuse every ledger", () => {
    expect([ledgerChecksum(""), ledgerChecksum("a"), ledgerChecksum("foobar")]).toEqual(["811c9dc5", "e40c292c", "bf9cf968"]);
  });
});

describe("isValidSlug", () => {
  it("takes kebab-case only: the slug becomes a folder name under .verify", () => {
    expect(["team-invites", "a1", "x"].map(isValidSlug)).toEqual([true, true, true]);
    expect(["../x", "Team", "a b", "a--b", "", "-a"].map(isValidSlug)).toEqual([false, false, false, false, false, false]);
  });
});

describe("parseLedger", () => {
  it("reads back the calls a well-formed ledger carries, in order", () => {
    const calls = [call(), call({ label: "build:1", phase: "Build", agent: "backend-builder", attempt: 2, outcome: "empty", verdict: "" })];
    expect(parseLedger(ledgerText(calls))).toEqual({ calls });
  });

  it("refuses a ledger whose text changed after the sum was taken: a garbled copy must not leave a wrong run.json", () => {
    const text = ledgerText([call(), call({ label: "fit" })]).replace("fit", "fix");
    expect(parseLedger(text)).toEqual({ error: expect.stringContaining("checksum") });
  });

  it("refuses a ledger with a line missing: the footer's count catches a dropped call", () => {
    const [first = "", , footer = ""] = ledgerText([call(), call({ label: "fit" })]).split("\n");
    expect(parseLedger([first, footer].join("\n"))).toEqual({ error: expect.stringContaining("counts 2 calls but 1 came") });
  });

  it("refuses empty input instead of recording zero calls", () => {
    expect(parseLedger("")).toEqual({ error: expect.any(String) });
  });
});

describe("mergeLedger", () => {
  it("keeps the tokens a call already had when the same call comes again, and leaves other workflows alone: a resumed run sends the whole ledger again", () => {
    const first = mergeLedger(emptyRunFile("demo"), "ship-feature", [call(), call({ label: "build:1", phase: "Build" })]);
    const calls = first.workflows["ship-feature"]?.calls ?? [];
    const withTokens = {
      ...first,
      workflows: {
        "plan-feature": { calls: [] },
        "ship-feature": { calls: calls.map((c, n) => (n === 0 ? { ...c, tokens: { in: 10, out: 5, cache_read: 0, cache_write: 0 }, seconds: 2, ran_model: "m" } : c)) },
      },
    };
    const again = mergeLedger(withTokens, "ship-feature", [call(), call({ label: "build:1", phase: "Build" }), call({ label: "docs", phase: "Docs" })]);
    const merged = again.workflows["ship-feature"]?.calls ?? [];
    expect(merged.map((c) => [c.label, c.tokens?.in ?? null, c.seconds])).toEqual([
      ["audit", 10, 2],
      ["build:1", null, null],
      ["docs", null, null],
    ]);
    expect(Object.keys(again.workflows).sort()).toEqual(["plan-feature", "ship-feature"]);
  });

  it("drops the old numbers when a different call now sits at that position: tokens must never be credited to the wrong call", () => {
    const first = mergeLedger(emptyRunFile("demo"), "ship-feature", [call()]);
    const calls = first.workflows["ship-feature"]?.calls ?? [];
    const withTokens = { ...first, workflows: { "ship-feature": { calls: calls.map((c) => ({ ...c, tokens: { in: 10, out: 5, cache_read: 0, cache_write: 0 } })) } } };
    const again = mergeLedger(withTokens, "ship-feature", [call({ label: "other" })]);
    expect(again.workflows["ship-feature"]?.calls[0]?.tokens ?? null).toBeNull();
  });
});

describe("parseRunFile", () => {
  it("round-trips a file it wrote", () => {
    const file = mergeLedger(emptyRunFile("demo"), "ship-feature", [call()]);
    expect(parseRunFile(JSON.stringify(file))).toEqual(file);
  });

  it("answers with a reason, not a file, for text that is not a run file: a hand edit must not be overwritten as if it were empty", () => {
    for (const text of ["{", "[]", JSON.stringify({ version: 1, slug: "../x", workflows: {} }), JSON.stringify({ version: 1, slug: "demo", workflows: { "Bad Name": { calls: [] } } })]) {
      expect(typeof parseRunFile(text)).toBe("string");
    }
  });
});
