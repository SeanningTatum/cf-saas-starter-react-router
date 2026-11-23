/**
 * The dry-run harness is what every workflow test trusts. If it silently stops failing a run (an
 * unanswered call a script swallowed, an answer that breaks its schema) or replays the wrong calls on
 * resume, every workflow test stays green while proving nothing. These tests pin those behaviours
 * with tiny fixture scripts in fixtures/workflow-dry-run/.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dryRun, labels, schemaErrors, seq, type DryRunOptions } from "../lib/workflow-dry-run";

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/workflow-dry-run/${name}.js`, import.meta.url));
const run = (name: string, options: DryRunOptions) => dryRun(name, { ...options, file: fixture(name) });

type Step = { prompt: string; opts?: Record<string, unknown> };
const steps = (...prompts: (string | Step)[]) => ({ steps: prompts.map((p) => (typeof p === "string" ? { prompt: p } : p)) });
/** Answers every call with `<tag>-<label>`, so a result shows which run answered it. */
const tagged = (tag: string): DryRunOptions["answers"] => [[() => true, ({ label }: { label: string }) => `${tag}-${label}`]];

describe("a run fails when the script swallowed the problem", () => {
  it("an agent call with no rule fails the run, though try/catch and parallel() both caught the throw", async () => {
    await expect(run("swallow", { answers: [] })).rejects.toThrow(/2 problem\(s\)[\s\S]*label "try"[\s\S]*label "par"/);
  });

  it("an answer that breaks its schema fails the run though the script caught it; a fitting answer or a dead agent (null) passes", async () => {
    const args = { schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } };
    await expect(
      run("swallow", {
        args,
        answers: [
          ["try", { ok: "yes" }],
          ["par", 1],
        ],
      }),
    ).rejects.toThrow(/"try" \(call 0\) does not fit its schema: \$\.ok: want boolean, got string/);

    const fits = await run("swallow", {
      args,
      answers: [
        ["try", { ok: true }],
        ["par", 1],
      ],
    });
    expect(fits.result).toEqual({ caught: 0, p: 1 });
    // null is an agent that died: the script must see it, not a schema failure.
    const died = await run("swallow", {
      args,
      answers: [
        ["try", null],
        ["par", 1],
      ],
    });
    expect(died.result).toEqual({ caught: 0, p: 1 });
  });
});

describe("schemaErrors", () => {
  it("type: a list of types accepts any of them; an integer counts as a number but a fraction is not an integer", () => {
    expect(schemaErrors({ type: ["string", "null"] }, null)).toEqual([]);
    expect(schemaErrors({ type: ["string", "null"] }, 1)).toEqual(["$: want string|null, got integer"]);
    expect(schemaErrors({ type: "number" }, 3)).toEqual([]);
    expect(schemaErrors({ type: "integer" }, 1.5)).toHaveLength(1);
    expect(schemaErrors({ type: "array" }, {})).toHaveLength(1);
    expect(schemaErrors({ type: "object" }, [])).toHaveLength(1);
  });

  it("required, additionalProperties (false or a schema), enum and items report the path of each bad value", () => {
    const schema = {
      type: "object",
      properties: { kind: { enum: ["a", "b"] }, need: { type: "number" }, list: { type: "array", items: { type: "string" } } },
      required: ["kind", "need"],
      additionalProperties: false,
    };
    expect(schemaErrors(schema, { kind: "a", need: 1, list: ["x"] })).toEqual([]);
    expect(schemaErrors(schema, { kind: "c", list: ["x", 2], extra: true })).toEqual([
      "$.need: required",
      '$.kind: "c" is not one of ["a","b"]',
      "$.list[1]: want string, got integer",
      "$.extra: not in the schema",
    ]);
    expect(schemaErrors({ type: "object", additionalProperties: { type: "number" } }, { a: 1, b: "x" })).toEqual(["$.b: want number, got string"]);
    // No additionalProperties keyword: unknown keys are allowed.
    expect(schemaErrors({ type: "object", properties: {} }, { anything: 1 })).toEqual([]);
  });
});

describe("resume", () => {
  it("replays calls while prompt and opts match; the first changed call and every one after it are live, even one that matches again", async () => {
    const first = await run("steps", { args: steps("a", "b", "c"), answers: tagged("old") });

    const same = await run("steps", { args: steps("a", "b", "c"), answers: [], resumeFrom: first });
    expect(same.result).toEqual(["old-a", "old-b", "old-c"]);
    expect(same.live).toEqual([]);

    // "c" has the same prompt and opts as before, but it follows a changed call.
    const changed = await run("steps", { args: steps("a", "X", "c"), answers: tagged("new"), resumeFrom: first });
    expect(changed.result).toEqual(["old-a", "new-X", "new-c"]);
    expect(changed.calls.map((c) => c.cached)).toEqual([true, false, false]);
    expect(labels(changed.live)).toEqual(["X", "c"]);

    // Same prompt, changed opts: live.
    const reopted = await run("steps", {
      args: steps("a", { prompt: "b", opts: { label: "b", model: "opus" } }, "c"),
      answers: tagged("new"),
      resumeFrom: first,
    });
    expect(reopted.result).toEqual(["old-a", "new-b", "new-c"]);
  });

  it("a call that returned null is not cached: resume runs it again", async () => {
    const first = await run("steps", { args: steps("a", "b", "c"), answers: [["b", null], ...tagged("old")] });
    expect(first.result).toEqual(["old-a", null, "old-c"]);

    const again = await run("steps", { args: steps("a", "b", "c"), answers: tagged("new"), resumeFrom: first });
    expect(again.result).toEqual(["old-a", "new-b", "new-c"]);
    expect(labels(again.live)).toEqual(["b", "c"]);
  });
});

describe("parallel and pipeline", () => {
  it("a throw becomes null and the rest still finish; pipeline stages get (prev, item, index)", async () => {
    const r = await run("fanout", {
      answers: [
        ["p1", "one"],
        ["p3", "three"],
      ],
    });
    expect(r.result).toEqual({
      p: ["one", null, "three"],
      q: [{ prev: 10, item: 1, i: 0 }, null, { prev: 30, item: 3, i: 2 }],
    });
  });
});

describe("clock and randomness", () => {
  it.each(["now", "new", "call", "random"])("%s throws: it would break resume", async (what) => {
    await expect(run("clock", { args: { what }, answers: [] })).rejects.toThrow(/is not available in a workflow script/);
  });

  it("a Date with an argument, Date.UTC and the rest of Math still work", async () => {
    const r = await run("clock", { args: { what: "fixed" }, answers: [] });
    expect(r.result).toEqual({ date: "2026-01-01T00:00:00.000Z", utc: Date.UTC(2026, 0, 1), floor: 2 });
  });
});

describe("answer rules", () => {
  it("the first matching rule wins, even over a more specific later one", async () => {
    const r = await run("steps", {
      args: steps("x", "y"),
      answers: [
        [/./, "broad"],
        ["x", "exact"],
      ],
    });
    expect(r.result).toEqual(["broad", "broad"]);
  });

  it("nth counts per rule, not per call; seq repeats its last answer; a function matcher sees the call", async () => {
    const r = await run("steps", {
      args: steps("x", "y", "x", "x"),
      answers: [
        [(c) => c.prompt === "y", ({ nth, n }: { nth: number; n: number }) => `y nth=${nth} n=${n}`],
        ["x", seq("a", "b")],
      ],
    });
    expect(r.result).toEqual(["a", "y nth=0 n=1", "b", "b"]);
  });
});

describe("what a run returns", () => {
  it("returns the script's result, meta, logs, phases, and each call's phase (opts.phase over the last phase())", async () => {
    const r = await run("steps", {
      args: steps("a", { prompt: "b", opts: { label: "b", phase: "Other" } }),
      answers: tagged("t"),
    });
    expect(r.result).toEqual(["t-a", "t-b"]);
    expect(r.meta.name).toBe("steps");
    expect(r.logs).toEqual(["ran 2"]);
    expect(r.phases).toEqual(["Run"]);
    expect(r.calls.map((c) => c.phase)).toEqual(["Run", "Other"]);
  });

  it("refuses a script that does not begin with `export const meta = `", async () => {
    await expect(run("no-meta", { answers: [] })).rejects.toThrow(/must begin with "export const meta = "/);
  });
});
