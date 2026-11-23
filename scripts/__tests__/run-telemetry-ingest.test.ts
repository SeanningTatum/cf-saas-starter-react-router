import { describe, it, expect } from "vitest";
import { run } from "../run-telemetry";
import { DIR, RUN_PATH, assistant, err, journal, memory, runFile, stored, text, tokens } from "./fixtures/run-telemetry/helpers";

describe("ingest", () => {
  const started = (key: string, agentId: string, label: string, phase = "Audit") => ({ type: "started", key, agentId, label, phase });
  const result = (key: string, agentId: string, value: unknown) => ({ type: "result", key, agentId, result: value });

  it("counts each message.id once and takes seconds from first to last timestamp: repeated stream lines must not inflate cost", () => {
    const files = {
      [RUN_PATH]: runFile({ "plan-feature": [stored(0)] }),
      [`${DIR}/journal.jsonl`]: journal([{ type: "launched" }, started("k1", "a1", "audit"), result("k1", "a1", { verdict: "ready" })]),
      [`${DIR}/agent-a1.jsonl`]: journal([
        { type: "user", timestamp: "2026-01-01T00:00:00.000Z" },
        assistant("m1", { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 2, cache_read_input_tokens: 100 }, "2026-01-01T00:00:01.000Z"),
        assistant("m1", { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 2, cache_read_input_tokens: 100 }, "2026-01-01T00:00:02.000Z"),
        assistant("m2", { input_tokens: 1, output_tokens: 7, cache_creation_input_tokens: 0, cache_read_input_tokens: 50 }, "2026-01-01T00:00:12.340Z"),
      ]),
    };
    const { deps, store } = memory(files);
    const o = run(["ingest", "demo", "plan-feature", DIR], deps);
    expect(text(o)).toBe("run-telemetry: 1 of 1 calls now have tokens; 0 journal entries had no ledger call and were added");
    const c = JSON.parse(store.get(RUN_PATH) ?? "").workflows["plan-feature"].calls[0];
    expect(c.tokens).toEqual({ in: 11, out: 12, cache_read: 150, cache_write: 2 });
    expect(c.seconds).toBe(12.3);
    expect(c.ran_model).toBe("claude-sonnet-5-5");
  });

  it("sets ran_model to the model seen most often: a one-off fallback must not name the run", () => {
    const files = {
      [RUN_PATH]: runFile({ w: [stored(0)] }),
      [`${DIR}/journal.jsonl`]: journal([started("k", "a1", "audit")]),
      [`${DIR}/agent-a1.jsonl`]: journal([
        assistant("m1", { input_tokens: 1, output_tokens: 1 }, "2026-01-01T00:00:00Z", "model-a"),
        assistant("m2", { input_tokens: 1, output_tokens: 1 }, "2026-01-01T00:00:01Z", "model-b"),
        assistant("m3", { input_tokens: 1, output_tokens: 1 }, "2026-01-01T00:00:02Z", "model-b"),
      ]),
    };
    const { deps, store } = memory(files);
    run(["ingest", "demo", "w", DIR], deps);
    expect(JSON.parse(store.get(RUN_PATH) ?? "").workflows.w.calls[0].ran_model).toBe("model-b");
  });

  it("pairs the k-th started with label L to the k-th ledger call with that label: same-label calls must not swap numbers", () => {
    const files = {
      [RUN_PATH]: runFile({ w: [stored(0, { label: "fix" }), stored(1, { label: "other" }), stored(2, { label: "fix" })] }),
      [`${DIR}/journal.jsonl`]: journal([started("k1", "a1", "fix"), started("k2", "a2", "fix"), started("k3", "a3", "other")]),
      [`${DIR}/agent-a1.jsonl`]: journal([assistant("m", { input_tokens: 1, output_tokens: 1 }, "2026-01-01T00:00:00Z")]),
      [`${DIR}/agent-a2.jsonl`]: journal([assistant("m", { input_tokens: 2, output_tokens: 2 }, "2026-01-01T00:00:00Z")]),
      [`${DIR}/agent-a3.jsonl`]: journal([assistant("m", { input_tokens: 3, output_tokens: 3 }, "2026-01-01T00:00:00Z")]),
    };
    const { deps, store } = memory(files);
    run(["ingest", "demo", "w", DIR], deps);
    const calls = JSON.parse(store.get(RUN_PATH) ?? "").workflows.w.calls;
    expect(calls.map((c: { tokens: { in: number } }) => c.tokens.in)).toEqual([1, 3, 2]);
  });

  it("reports journal entries that have no ledger call: a drift between journal and ledger must show", () => {
    const files = {
      [RUN_PATH]: runFile({ w: [stored(0, { label: "fix" })] }),
      [`${DIR}/journal.jsonl`]: journal([started("k1", "a1", "fix"), started("k2", "a2", "fix"), started("k3", "a3", "ghost")]),
    };
    const { deps } = memory(files);
    expect(text(run(["ingest", "demo", "w", DIR], deps))).toBe(
      "run-telemetry: 0 of 3 calls now have tokens; 2 journal entries had no ledger call and were added",
    );
  });

  it("leaves a call null when its agent file is missing: never invent a number", () => {
    const files = {
      [RUN_PATH]: runFile({ w: [stored(0)] }),
      [`${DIR}/journal.jsonl`]: journal([started("k1", "a1", "audit")]),
    };
    const { deps, store } = memory(files);
    const o = run(["ingest", "demo", "w", DIR], deps);
    expect(o.code).toBe(0);
    expect(JSON.parse(store.get(RUN_PATH) ?? "").workflows.w.calls[0]).toMatchObject({ tokens: null, seconds: null, ran_model: null });
  });

  it("survives garbage lines and a transcript with no usage: an odd file means n/a, not a crash", () => {
    const files = {
      [RUN_PATH]: runFile({ w: [stored(0)] }),
      [`${DIR}/journal.jsonl`]: `not json\n${JSON.stringify(started("k1", "a1", "audit"))}\n[1,2]\n`,
      [`${DIR}/agent-a1.jsonl`]: `{{{\n${JSON.stringify({ type: "assistant", message: { id: "m", usage: "lots" } })}\n`,
    };
    const { deps, store } = memory(files);
    const o = run(["ingest", "demo", "w", DIR], deps);
    expect(o.code).toBe(0);
    expect(JSON.parse(store.get(RUN_PATH) ?? "").workflows.w.calls[0].tokens).toBeNull();
  });

  it("fails on a directory without journal.jsonl and writes nothing: a wrong path must be loud", () => {
    const { deps, writes } = memory({ [RUN_PATH]: runFile({ w: [stored(0)] }) });
    const o = run(["ingest", "demo", "w", DIR], deps);
    expect(o.code).toBe(1);
    expect(err(o)).toContain("journal.jsonl");
    expect(writes).toEqual([]);
  });

  it("builds the calls from the journal when no ledger exists: a crashed run still yields numbers", () => {
    const files = {
      [`${DIR}/journal.jsonl`]: journal([started("k1", "a1", "audit"), result("k1", "a1", { pass: false }), started("k2", "a2", "build", "Build")]),
      [`${DIR}/agent-a1.meta.json`]: JSON.stringify({ agentType: "ticket-auditor", model: "sonnet" }),
      [`${DIR}/agent-a1.jsonl`]: journal([assistant("m", { input_tokens: 4, output_tokens: 2 }, "2026-01-01T00:00:00Z")]),
    };
    const { deps, store } = memory(files);
    const o = run(["ingest", "demo", "ship-feature", DIR], deps);
    expect(text(o)).toBe("run-telemetry: 1 of 2 calls now have tokens; 0 journal entries had no ledger call and were added");
    const calls = JSON.parse(store.get(RUN_PATH) ?? "").workflows["ship-feature"].calls;
    expect(calls[0]).toMatchObject({ label: "audit", phase: "Audit", agent: "ticket-auditor", model: "sonnet", outcome: "ok", verdict: "fail", attempt: 1 });
    expect(calls[1]).toMatchObject({ label: "build", phase: "Build", agent: "", outcome: "empty", verdict: "" });
  });

  it("keeps tokens a call already has: a second ingest must not hand them to another call", () => {
    const files = {
      [RUN_PATH]: runFile({ w: [stored(0, { tokens: tokens(9, 9), agent_id: "a1" })] }),
      [`${DIR}/journal.jsonl`]: journal([started("k1", "a1", "audit")]),
      [`${DIR}/agent-a1.jsonl`]: journal([assistant("m", { input_tokens: 1, output_tokens: 1 }, "2026-01-01T00:00:00Z")]),
    };
    const { deps, store } = memory(files);
    const o = run(["ingest", "demo", "w", DIR], deps);
    expect(text(o)).toContain("1 of 1 calls now have tokens; 0 journal entries had no ledger call and were added");
    expect(JSON.parse(store.get(RUN_PATH) ?? "").workflows.w.calls[0].tokens).toEqual(tokens(9, 9));
  });

  it("adds the runner and memory calls the ledger could not hold, and summary counts them: the last calls must reach the report", () => {
    const labels = ["a", "b", "c", "run:record", "memory:record"];
    const files = {
      [RUN_PATH]: runFile({ w: ["a", "b", "c"].map((label, n) => stored(n, { label })) }),
      [`${DIR}/journal.jsonl`]: journal(labels.flatMap((label, n) => [started(`k${n}`, `a${n}`, label), result(`k${n}`, `a${n}`, { pass: true })])),
    };
    const { deps } = memory(files);
    expect(text(run(["ingest", "demo", "w", DIR], deps))).toBe(
      "run-telemetry: 0 of 5 calls now have tokens; 2 journal entries had no ledger call and were added",
    );
    const total = run(["summary", "demo"], deps).stdout.find((l) => l.startsWith("total")) ?? "";
    expect(total.split(/\s+/)[1]).toBe("5");
  });

  it("never builds a file name from an agentId with path characters: a journal must not read outside its directory", () => {
    const evil = "../../secret";
    const files = {
      [RUN_PATH]: runFile({ w: [stored(0)] }),
      [`${DIR}/journal.jsonl`]: journal([started("k1", evil, "audit")]),
      [`${DIR}/${evil}.jsonl`]: journal([assistant("m", { input_tokens: 1, output_tokens: 1 }, "2026-01-01T00:00:00Z")]),
      [`${DIR}/agent-${evil}.jsonl`]: journal([assistant("m", { input_tokens: 1, output_tokens: 1 }, "2026-01-01T00:00:00Z")]),
    };
    const { deps, store } = memory(files);
    const o = run(["ingest", "demo", "w", DIR], deps);
    expect(o.code).toBe(0);
    expect(JSON.parse(store.get(RUN_PATH) ?? "").workflows.w.calls[0]).toMatchObject({ tokens: null, seconds: null, ran_model: null });
  });
});
