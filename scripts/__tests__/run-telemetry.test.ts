import { describe, it, expect } from "vitest";
import { run } from "../run-telemetry";
import { ledgerChecksum } from "../lib/run-telemetry";
import {
  ledgerChecksum as workflowChecksum,
  runRecordCommand,
} from "../../.claude/workflow-src/lib.js";
import { RUN_PATH, call, err, ledgerText, memory, runFile, stored, tokens } from "./fixtures/run-telemetry/helpers";

describe("record", () => {
  it("writes pretty JSON with a trailing newline and prints the one contract line: later tools parse that file", () => {
    const { deps, store } = memory({}, ledgerText([call(), call({ label: "build", phase: "Build", agent: "runner", verdict: "pass" })]));
    const o = run(["record", "demo", "ship-feature"], deps);
    expect(o.code).toBe(0);
    expect(o.stdout).toEqual(["run-telemetry: recorded 2 calls for ship-feature in .verify/demo/run.json"]);
    const body = store.get(RUN_PATH) ?? "";
    expect(body.endsWith("}\n")).toBe(true);
    expect(body).toContain('\n  "version": 1,');
    const parsed = JSON.parse(body);
    expect(parsed.workflows["ship-feature"].calls[1]).toEqual(stored(1, { label: "build", phase: "Build", agent: "runner", verdict: "pass" }));
  });

  it("refuses a garbled copy and writes nothing: a wrong ledger is worse than none", () => {
    const garbled = ledgerText([call()], { check: "00000000" });
    const { deps, writes } = memory({}, garbled);
    const o = run(["record", "demo", "ship-feature"], deps);
    expect(o.code).toBe(1);
    expect(err(o)).toContain("garbled");
    expect(writes).toEqual([]);
  });

  it("refuses a footer that miscounts the calls: a dropped line must not pass as a short run", () => {
    const { deps, writes } = memory({}, ledgerText([call(), call()], { count: 3 }));
    const o = run(["record", "demo", "ship-feature"], deps);
    expect(o.code).toBe(1);
    expect(err(o)).toContain("3 calls but 2 came");
    expect(writes).toEqual([]);
  });

  it("refuses empty stdin: a runner that sent nothing must not create an empty ledger", () => {
    const { deps, writes } = memory({}, "");
    expect(run(["record", "demo", "ship-feature"], deps).code).toBe(1);
    expect(writes).toEqual([]);
  });

  it.each([
    ["a line with six fields", '["a","p","x","",1,"ok"]'],
    ["an outcome outside ok, empty, threw", '["a","p","x","",1,"great","v"]'],
    ["an attempt of zero", '["a","p","x","",0,"ok","v"]'],
    ["an attempt that is not whole", '["a","p","x","",1.5,"ok","v"]'],
    ["a number where a label belongs", '[1,"p","x","",1,"ok","v"]'],
    ["a line that is not an array", '{"label":"a"}'],
  ])("rejects %s: a malformed call must not reach run.json", (_name, line) => {
    const body = `${line}\n${JSON.stringify({ calls: 1, check: ledgerChecksum(line) })}\n`;
    const { deps, writes } = memory({}, body);
    const o = run(["record", "demo", "ship-feature"], deps);
    expect(o.code).toBe(1);
    expect(writes).toEqual([]);
  });

  it.each(["../escape", "Demo", "a/b", "a--b", "-a", ""])("rejects the slug %j: the slug becomes a path under .verify", (slug) => {
    const { deps, writes } = memory({}, ledgerText([call()]));
    const o = run(["record", slug, "ship-feature"], deps);
    expect(o.code).not.toBe(0);
    expect(writes).toEqual([]);
  });

  it("rejects a workflow name that breaks the pattern: it is a key and must stay plain", () => {
    const { deps, writes } = memory({}, ledgerText([call()]));
    expect(run(["record", "demo", "Ship Feature"], deps).code).toBe(1);
    expect(writes).toEqual([]);
  });

  it("refuses a malformed run.json and leaves it as it was: a silent overwrite would lose data", () => {
    const { deps, store, writes } = memory({ [RUN_PATH]: "{not json" }, ledgerText([call()]));
    const o = run(["record", "demo", "ship-feature"], deps);
    expect(o.code).toBe(1);
    expect(err(o)).toContain("unreadable");
    expect(writes).toEqual([]);
    expect(store.get(RUN_PATH)).toBe("{not json");
  });

  it("refuses a run.json whose calls are malformed: tokens of the wrong type would poison the sums", () => {
    const bad = runFile({ "ship-feature": [stored(0, { tokens: { in: "many" } })] });
    const { deps, writes } = memory({ [RUN_PATH]: bad }, ledgerText([call()]));
    expect(run(["record", "demo", "ship-feature"], deps).code).toBe(1);
    expect(writes).toEqual([]);
  });

  it("keeps tokens when the new ledger strictly extends the stored one: a resumed run resends the whole ledger", () => {
    const before = runFile({ "ship-feature": [stored(0, { verdict: "ready", tokens: tokens(5, 6), seconds: 2.5, ran_model: "claude-x" })] });
    const { deps, store } = memory({ [RUN_PATH]: before }, ledgerText([call(), call({ label: "new" })]));
    run(["record", "demo", "ship-feature"], deps);
    const calls = JSON.parse(store.get(RUN_PATH) ?? "").workflows["ship-feature"].calls;
    expect(calls[0]).toMatchObject({ tokens: tokens(5, 6), seconds: 2.5, ran_model: "claude-x" });
    expect(calls[1]).toMatchObject({ label: "new", tokens: null, seconds: null, ran_model: null });
  });

  it("drops tokens when the label at that position changed: the old numbers belong to another call", () => {
    const before = runFile({ "ship-feature": [stored(0, { tokens: tokens(5, 6), seconds: 2.5, ran_model: "claude-x" })] });
    const { deps, store } = memory({ [RUN_PATH]: before }, ledgerText([call({ label: "other" })]));
    run(["record", "demo", "ship-feature"], deps);
    const calls = JSON.parse(store.get(RUN_PATH) ?? "").workflows["ship-feature"].calls;
    expect(calls[0]).toMatchObject({ tokens: null, seconds: null, ran_model: null });
  });

  it("leaves other workflows in the file alone: plan-feature and ship-feature share a slug", () => {
    const before = runFile({ "plan-feature": [stored(0, { verdict: "ready", tokens: tokens(1, 2) })] });
    const { deps, store } = memory({ [RUN_PATH]: before }, ledgerText([call()]));
    run(["record", "demo", "ship-feature"], deps);
    const workflows = JSON.parse(store.get(RUN_PATH) ?? "").workflows;
    expect(Object.keys(workflows)).toEqual(["plan-feature", "ship-feature"]);
    expect(workflows["plan-feature"].calls[0].tokens).toEqual(tokens(1, 2));
  });

  it("accepts a ledger of zero calls: a run that stopped before any agent still reports", () => {
    const { deps, store } = memory({}, ledgerText([]));
    const o = run(["record", "demo", "ship-feature"], deps);
    expect(o.code).toBe(0);
    expect(JSON.parse(store.get(RUN_PATH) ?? "").workflows["ship-feature"].calls).toEqual([]);
  });

  it("rejects a string field over 120 characters and names the field and line: a huge label must not reach a PR body", () => {
    const long = "x".repeat(121);
    const { deps, writes } = memory({}, ledgerText([call(), call({ phase: long })]));
    const o = run(["record", "demo", "ship-feature"], deps);
    expect(o.code).toBe(1);
    expect(err(o)).toBe("run-telemetry: call line 2: phase is longer than 120 characters");
    expect(writes).toEqual([]);
  });

  it("accepts a string field of exactly 120 characters: the cap must not bite early", () => {
    const { deps } = memory({}, ledgerText([call({ label: "x".repeat(120) })]));
    expect(run(["record", "demo", "ship-feature"], deps).code).toBe(0);
  });

  it.each([
    ["a workflow key that breaks the slug pattern", { version: 1, slug: "demo", workflows: { "Bad Key": { calls: [] } } }],
    ["a __proto__ workflow key", '{"version":1,"slug":"demo","workflows":{"__proto__":{"calls":[]}}}'],
    ["a slug that breaks the pattern", { version: 1, slug: "../x", workflows: {} }],
    ["a call string over 120 characters", { version: 1, slug: "demo", workflows: { w: { calls: [stored(0, { phase: "p".repeat(121) })] } } }],
  ])("treats a run.json with %s as unreadable and leaves it alone: a hand edit must not steer later writes", (_name, content) => {
    const before = typeof content === "string" ? content : JSON.stringify(content);
    const { deps, store, writes } = memory({ [RUN_PATH]: before }, ledgerText([call()]));
    const o = run(["record", "demo", "ship-feature"], deps);
    expect(o.code).toBe(1);
    expect(err(o)).toContain("unreadable");
    expect(writes).toEqual([]);
    expect(store.get(RUN_PATH)).toBe(before);
  });
});

describe("run", () => {
  it("exits 2 with usage on an unknown verb or none: the caller sees how to call it", () => {
    for (const argv of [[], ["frobnicate"]]) {
      const o = run(argv, memory().deps);
      expect(o.code).toBe(2);
      expect(err(o)).toContain("usage:");
    }
  });
});

describe("workflow library cross-check", () => {
  it("agrees with lib.js on the checksum, ASCII and not: two copies that differ break every record", () => {
    for (const sample of ["", "a", "foobar", "line one\nline two", '["é","naïve","日本"]', "emoji 😀"]) {
      expect(ledgerChecksum(sample)).toBe(workflowChecksum(sample));
    }
  });

  it("accepts the stdin body lib.js builds: the runner copies it and record must take it", () => {
    const entries = [
      { label: "preflight", phase: "Preflight", agent: "runner", model: "", attempt: 1, outcome: "ok", verdict: "pass" },
      { label: "cafe-2", phase: "Audit", agent: "ticket-auditor", model: "sonnet", attempt: 2, outcome: "empty", verdict: "" },
      { label: "has RUN_EOF inside", phase: "X", agent: "runner", model: "", attempt: 1, outcome: "threw", verdict: "" },
    ];
    const command: string = runRecordCommand("ship-feature", "demo", entries);
    const [head = "", ...rest] = command.split("\n");
    expect(head).toBe("bun scripts/run-telemetry.ts record demo ship-feature <<'RUN_EOF'");
    expect(rest[rest.length - 1]).toBe("RUN_EOF");
    const body = `${rest.slice(0, -1).join("\n")}\n`;
    const { deps, store } = memory({}, body);
    const o = run(["record", "demo", "ship-feature"], deps);
    expect(o.code).toBe(0);
    const calls = JSON.parse(store.get(RUN_PATH) ?? "").workflows["ship-feature"].calls;
    expect(calls.map((c: { label: string }) => c.label)).toEqual(["preflight", "cafe-2", "has RUN-EOF inside"]);
    expect(calls[1]).toMatchObject({ attempt: 2, outcome: "empty", model: "sonnet" });
  });
});

