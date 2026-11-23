import { describe, expect, it } from "vitest";
import { emptyRunFile, mergeLedger, type Call, type LedgerCall } from "../run-telemetry";
import { ingestJournals, type Journal } from "../run-telemetry-ingest";

const DIR = "/runs/r1";

const ledgerCall = (label: string, over: Partial<LedgerCall> = {}): LedgerCall => ({
  label,
  phase: "Build",
  agent: "runner",
  model: "",
  attempt: 1,
  outcome: "ok",
  verdict: "",
  ...over,
});

const callsFor = (labels: string[]): Call[] =>
  mergeLedger(
    emptyRunFile("demo"),
    "w",
    labels.map((l) => ledgerCall(l)),
  ).workflows.w?.calls.slice() ?? [];

const journalOf = (dir: string, entries: Array<[string, string]>): Journal => ({
  dir,
  text: entries
    .flatMap(([id, label]) => [
      JSON.stringify({ type: "started", key: `k-${id}`, agentId: id, label, phase: "Build" }),
      JSON.stringify({ type: "result", key: `k-${id}`, agentId: id, result: { ok: true } }),
    ])
    .join("\n"),
});

const transcript = (tokensIn: number): string =>
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-01-01T00:00:00Z",
    message: { id: "m", model: "claude-x", usage: { input_tokens: tokensIn, output_tokens: 1 } },
  });

const readerFor = (files: Record<string, string>) => (path: string) => files[path] ?? null;

const tokensIn = (calls: ReadonlyArray<Call>) => calls.map((c) => c.tokens?.in ?? null);
const idsOf = (calls: ReadonlyArray<Call>) => calls.map((c) => c.agent_id);

describe("ingestJournals pairing", () => {
  it("keeps a call without a transcript empty on every later ingest: a second pass must not hand the first call's numbers to it", () => {
    const read = readerFor({ [`${DIR}/agent-a1.jsonl`]: transcript(11) });
    const journals = [
      journalOf(DIR, [
        ["a1", "fix"],
        ["a2", "fix"],
      ]),
    ];
    const first = ingestJournals(callsFor(["fix", "fix"]), journals, read);
    const second = ingestJournals(first.calls, journals, read);
    expect(tokensIn(second.calls)).toEqual([11, null]);
    expect(idsOf(second.calls)).toEqual(["a1", "a2"]);
  });

  it("changes nothing when the same directory is ingested twice: ingest must be safe to repeat", () => {
    const read = readerFor({ [`${DIR}/agent-a1.jsonl`]: transcript(5), [`${DIR}/agent-a2.jsonl`]: transcript(6) });
    const journals = [
      journalOf(DIR, [
        ["a1", "x"],
        ["a2", "y"],
      ]),
    ];
    const first = ingestJournals(callsFor(["x", "y"]), journals, read);
    expect(ingestJournals(first.calls, journals, read).calls).toEqual(first.calls);
  });

  it("fills only the calls a second directory ran: a resumed run adds to the first run's numbers", () => {
    const read = readerFor({
      "/r1/agent-a1.jsonl": transcript(1),
      "/r1/agent-a2.jsonl": transcript(2),
      "/r2/agent-b1.jsonl": transcript(3),
      "/r2/agent-b2.jsonl": transcript(4),
    });
    const one = ingestJournals(
      callsFor(["a", "b", "c", "d"]),
      [
        journalOf("/r1", [
          ["a1", "a"],
          ["a2", "b"],
        ]),
      ],
      read,
    );
    const two = ingestJournals(
      one.calls,
      [
        journalOf("/r2", [
          ["b1", "c"],
          ["b2", "d"],
        ]),
      ],
      read,
    );
    expect(tokensIn(one.calls)).toEqual([1, 2, null, null]);
    expect(tokensIn(two.calls)).toEqual([1, 2, 3, 4]);
    expect(idsOf(two.calls)).toEqual(["a1", "a2", "b1", "b2"]);
  });

  it("replaces numbers when a newer run of the same calls is ingested: a fresh run that extended an older one ends with its own ids", () => {
    const oldRun = ingestJournals(
      callsFor(["a", "b"]),
      [
        journalOf("/old", [
          ["o1", "a"],
          ["o2", "b"],
        ]),
      ],
      readerFor({ "/old/agent-o1.jsonl": transcript(1), "/old/agent-o2.jsonl": transcript(2) }),
    );
    const file = { ...emptyRunFile("demo"), workflows: { w: { calls: oldRun.calls } } };
    const extended =
      mergeLedger(
        file,
        "w",
        ["a", "b", "c", "d"].map((l) => ledgerCall(l)),
      ).workflows.w?.calls ?? [];
    expect(tokensIn(extended)).toEqual([1, 2, null, null]);
    const read = readerFor(Object.fromEntries([1, 2, 3, 4].map((n) => [`/new/agent-n${n}.jsonl`, transcript(n * 10)])));
    const fresh = journalOf("/new", [
      ["n1", "a"],
      ["n2", "b"],
      ["n3", "c"],
      ["n4", "d"],
    ]);
    const done = ingestJournals(extended, [fresh], read);
    expect(idsOf(done.calls)).toEqual(["n1", "n2", "n3", "n4"]);
    expect(tokensIn(done.calls)).toEqual([10, 20, 30, 40]);
  });

  it("adds journal entries the ledger lacks as calls and counts them: the last runner and memory calls must reach the report", () => {
    const journals = [
      journalOf(DIR, [
        ["a1", "x"],
        ["a2", "y"],
        ["a3", "z"],
        ["a4", "run:record"],
        ["a5", "memory:record"],
      ]),
    ];
    const read = readerFor({
      [`${DIR}/agent-a4.jsonl`]: transcript(7),
      [`${DIR}/agent-a4.meta.json`]: JSON.stringify({ agentType: "runner", model: "haiku" }),
    });
    const done = ingestJournals(callsFor(["x", "y", "z"]), journals, read);
    expect(done.added).toBe(2);
    expect(done.calls.map((c) => c.label)).toEqual(["x", "y", "z", "run:record", "memory:record"]);
    expect(done.calls.map((c) => c.from_journal)).toEqual([false, false, false, true, true]);
    expect(done.calls[3]).toMatchObject({ n: 3, agent: "runner", model: "haiku", outcome: "ok", agent_id: "a4", attempt: 1 });
    expect(ingestJournals(done.calls, journals, read).added).toBe(0);
  });

  it("keeps the numbers of appended calls when a later ledger contains them and does not duplicate them: the strict-extension rule must see through them", () => {
    const journals = [
      journalOf(DIR, [
        ["a1", "x"],
        ["a2", "y"],
        ["a3", "z"],
        ["a4", "run:record"],
        ["a5", "memory:record"],
      ]),
    ];
    const read = readerFor({ [`${DIR}/agent-a4.jsonl`]: transcript(7), [`${DIR}/agent-a5.jsonl`]: transcript(8) });
    const done = ingestJournals(callsFor(["x", "y", "z"]), journals, read);
    const file = { ...emptyRunFile("demo"), workflows: { w: { calls: done.calls } } };
    const later = ["x", "y", "z", "run:record", "memory:record", "p", "q"].map((l) => ledgerCall(l));
    const merged = mergeLedger(file, "w", later).workflows.w?.calls ?? [];
    expect(merged).toHaveLength(7);
    expect(tokensIn(merged)).toEqual([null, null, null, 7, 8, null, null]);
    expect(idsOf(merged).slice(3, 5)).toEqual(["a4", "a5"]);
    expect(merged.every((c) => !c.from_journal)).toBe(true);
  });
});
