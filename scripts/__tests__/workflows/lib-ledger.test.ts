import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { workflowLib, ledgerChecksum, verdictOf, runRecordCommand, runSummaryNote, LEDGER_FIELD_MAX } from "../../../.claude/workflow-src/lib.js";

const LIB_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".claude", "workflow-src", "lib.js");

function wired(agent: (prompt: string, opts?: unknown) => unknown = async () => null) {
  const logs: string[] = [];
  const calls: { prompt: string; opts: unknown }[] = [];
  const lib = workflowLib({
    agent: (prompt: string, opts?: unknown) => {
      calls.push({ prompt, opts });
      return agent(prompt, opts);
    },
    log: (m: string) => void logs.push(m),
    name: "wf",
  });
  return { lib, logs, calls };
}

describe("ledgerChecksum", () => {
  const reference = (units: number[]) => {
    let h = 0x811c9dc5n;
    for (const u of units) h = ((h ^ BigInt(u)) * 0x01000193n) & 0xffffffffn;
    return h.toString(16).padStart(8, "0");
  };

  it("matches the contract's three vectors: scripts/run-telemetry.ts checks the same sum, so one drifting digit rejects every ledger", () => {
    expect(ledgerChecksum("")).toBe("811c9dc5");
    expect(ledgerChecksum("a")).toBe("e40c292c");
    expect(ledgerChecksum("foobar")).toBe("bf9cf968");
  });

  it("sums UTF-16 code units, not bytes, and multiplies as a 32-bit integer: a label with an accent or an emoji must verify", () => {
    const text = "é😀 phase ".repeat(20);
    const units = Array.from({ length: text.length }, (_, i) => text.charCodeAt(i));
    expect(ledgerChecksum(text)).toBe(reference(units));
  });
});

describe("verdictOf", () => {
  it("takes the verdict string when there is one, even next to a boolean", () => {
    expect(verdictOf({ verdict: "ready", ok: false })).toBe("ready");
    expect(verdictOf({ verdict: "" })).toBe("");
  });

  it("reads pass or fail from the first of ok, pass, passed that is a boolean: a gate that says ok:false must never show as pass", () => {
    expect(verdictOf({ ok: true })).toBe("pass");
    expect(verdictOf({ ok: false })).toBe("fail");
    expect(verdictOf({ pass: true })).toBe("pass");
    expect(verdictOf({ passed: false })).toBe("fail");
    expect(verdictOf({ ok: "yes", pass: false, passed: true })).toBe("fail");
    expect(verdictOf({ verdict: 3, ok: true })).toBe("pass");
  });

  it("gives an empty string for a non-object, null, undefined or an object with none of those fields", () => {
    for (const r of ["text", 5, true, null, undefined, {}, { ok: "yes" }, []]) expect(verdictOf(r)).toBe("");
  });
});

describe("runRecordCommand", () => {
  const call = (over: Record<string, unknown> = {}) => ({
    label: "preflight",
    phase: "Preflight",
    agent: "runner",
    model: "",
    attempt: 1,
    outcome: "ok",
    verdict: "pass",
    ...over,
  });

  it("writes the heredoc byte for byte for a two-call ledger: the script parses this exact layout and checks its count and sum", () => {
    expect(
      runRecordCommand("ship-feature", "demo", [
        call(),
        call({ label: "audit", phase: "Audit", agent: "ticket-auditor", attempt: 2, outcome: "empty", verdict: "" }),
      ]),
    ).toBe(
      [
        "bun scripts/run-telemetry.ts record demo ship-feature <<'RUN_EOF'",
        '["preflight","Preflight","runner","",1,"ok","pass"]',
        '["audit","Audit","ticket-auditor","",2,"empty",""]',
        '{"calls":2,"check":"0fc84437"}',
        "RUN_EOF",
      ].join("\n"),
    );
  });

  it("cuts every string field to the cap and turns characters outside the safe set into hyphens: an agent's verdict must not carry a quote, a backtick, $() or a newline into a shell line", () => {
    const hostile = `x"'\`$(id)\n;|&<>${"a".repeat(500)}`;
    const cmd = runRecordCommand("w", "d", [call({ verdict: hostile, label: hostile })]);
    const lines = cmd.split("\n");
    expect(lines).toHaveLength(4);
    const [, callLine = "", footerLine = ""] = lines;
    const [label, , , , , , verdict] = JSON.parse(callLine) as string[];
    for (const field of [label, verdict]) {
      expect(field).toHaveLength(LEDGER_FIELD_MAX);
      expect(field).toMatch(/^[A-Za-z0-9 :._/#()-]+$/);
    }
    expect(verdict?.startsWith("x----(id)")).toBe(true);
    expect(JSON.parse(footerLine)).toEqual({ calls: 1, check: ledgerChecksum(callLine) });
    expect(LEDGER_FIELD_MAX).toBe(80);
  });

  it("writes only the footer for an empty ledger, with the empty-string checksum", () => {
    expect(runRecordCommand("w", "d", [])).toBe('bun scripts/run-telemetry.ts record d w <<\'RUN_EOF\'\n{"calls":0,"check":"811c9dc5"}\nRUN_EOF');
  });

  it("a label holding RUN_EOF or a newline cannot end the heredoc or add a line: a ticket-derived label must not run a shell command", () => {
    const cmd = runRecordCommand("w", "d", [call({ label: "a\nRUN_EOF\nrm -rf /", phase: "RUN_EOF", agent: "x\r\ny", verdict: "RUN_EOFRUN_EOF" })]);
    const lines = cmd.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines.filter((l) => l === "RUN_EOF")).toEqual(["RUN_EOF"]);
    expect(cmd.endsWith("\nRUN_EOF")).toBe(true);
    const [, callLine = "", footerLine = ""] = lines;
    expect(JSON.parse(callLine)).toEqual(["a-RUN-EOF-rm -rf /", "RUN-EOF", "x--y", "", 1, "ok", "RUN-EOFRUN-EOF"]);
    expect(JSON.parse(footerLine)).toEqual({ calls: 1, check: ledgerChecksum(callLine) });
  });
});

describe("tracked", () => {
  it("returns the agent's value untouched and passes the prompt and opts through: a wrapper that cloned or trimmed them would break replay from cache", async () => {
    const value = { ok: true, nested: { a: 1 } };
    const { lib, calls } = wired(async () => value);
    const opts = { label: "l", phase: "P", agentType: "runner", model: "sonnet" };
    expect(await lib.tracked("do it", opts)).toBe(value);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.prompt).toBe("do it");
    expect(calls[0]?.opts).toBe(opts);
  });

  it("rethrows the agent's own error, async or sync, and records the call as threw: a run must not lose a failure or swallow it", async () => {
    const boom = new Error("boom");
    const asyncFail = wired(async () => {
      throw boom;
    });
    await expect(asyncFail.lib.tracked("p", { label: "a" })).rejects.toBe(boom);
    const syncFail = wired(() => {
      throw boom;
    });
    expect(() => syncFail.lib.tracked("p", { label: "s" })).toThrow(boom);
    expect(asyncFail.lib.ledger().map((e: { outcome: string }) => e.outcome)).toEqual(["threw"]);
    expect(syncFail.lib.ledger().map((e: { outcome: string }) => e.outcome)).toEqual(["threw"]);
  });

  it("records ok for a value, empty for null or undefined and threw for an error, with label, phase, agent, model and verdict: the ledger is the only record of what a run did", async () => {
    const answers: Record<string, unknown> = { good: { verdict: "ready" }, text: "done", none: null, missing: undefined };
    const { lib } = wired(async (_p, o) => {
      const label = (o as { label: string }).label;
      if (label === "bad") throw new Error("x");
      return answers[label];
    });
    const opts = (label: string) => ({ label, phase: "Audit", agentType: "ticket-auditor", model: "opus" });
    for (const label of ["good", "text", "none", "missing", "bad"]) await lib.tracked("p", opts(label)).catch(() => null);
    const row = (label: string, outcome: string, verdict = "") => ({
      label,
      phase: "Audit",
      agent: "ticket-auditor",
      model: "opus",
      attempt: 1,
      outcome,
      verdict,
    });
    expect(lib.ledger()).toEqual([row("good", "ok", "ready"), row("text", "ok"), row("none", "empty"), row("missing", "empty"), row("bad", "threw")]);
  });

  it("keeps call order when a later call settles first, and leaves a call still running out of ledger(): the order is what the script reads back", async () => {
    let release: (v: string) => void = () => undefined;
    const { lib } = wired((_p, o) => ((o as { label: string }).label === "slow" ? new Promise<string>((r) => (release = r)) : Promise.resolve("fast")));
    const slow = lib.tracked("p", { label: "slow" });
    await lib.tracked("p", { label: "fast" });
    expect(lib.ledger().map((e: { label: string }) => e.label)).toEqual(["fast"]);
    release("late");
    await slow;
    expect(lib.ledger().map((e: { label: string }) => e.label)).toEqual(["slow", "fast"]);
  });
});

describe("twice and the ledger", () => {
  const attempts = (ledger: { label: string; attempt: number }[]) => ledger.map((e) => [e.label, e.attempt]);

  it("atAttempt marks only the call made inside it: a workflow that retries by hand, outside twice(), must still show as a retry", async () => {
    const { lib } = wired(async () => "r");
    await lib.tracked("p", { label: "first" });
    await lib.atAttempt(2, () => lib.tracked("p", { label: "by-hand" }));
    await lib.tracked("p", { label: "after" });
    expect(attempts(lib.ledger())).toEqual([
      ["first", 1],
      ["by-hand", 2],
      ["after", 1],
    ]);
  });

  it("marks the retry attempt 2, and a parallel sibling and a later first-try call stay attempt 1: the retry flag must not leak to another call", async () => {
    let sibling: Promise<unknown> = Promise.resolve();
    const { lib } = wired(async (_p, o) => {
      if ((o as { label: string }).label === "try2") {
        await null;
        sibling = lib.tracked("q", { label: "sibling" });
      }
      return "r";
    });
    await lib.twice(async (n: number) => {
      const r = await lib.tracked("p", { label: `try${n}` });
      return n === 2 ? r : null;
    }, "x");
    await sibling;
    await lib.tracked("p", { label: "after" });
    expect(attempts(lib.ledger())).toEqual([
      ["try1", 1],
      ["try2", 2],
      ["sibling", 1],
      ["after", 1],
    ]);
  });

  it("keeps attempt 2 for a call made by a twice nested inside a retry: plan-feature's ux step wraps one twice in another", async () => {
    const { lib } = wired(async () => "r");
    let outer = 0;
    await lib.twice(async () => {
      outer += 1;
      return lib.twice(async () => (outer === 1 ? null : lib.tracked("p", { label: `outer${outer}` })), "inner");
    }, "outer");
    expect(attempts(lib.ledger())).toEqual([["outer2", 2]]);
  });
});

describe("workflow sources and the ledger", () => {
  const SRC_DIR = dirname(LIB_PATH);
  const sources = ["plan-feature", "ship-feature", "brand-init", "eval-plan-feature"];
  const source = (name: string) => readFileSync(join(SRC_DIR, `${name}.js`), "utf8");
  const code = (name: string) =>
    source(name)
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");

  it.each(sources)(
    "%s calls agent( nowhere but the workflowLib hand-off: a call that dodges tracked() is missing from the ledger and the cost report",
    (name) => {
      expect(code(name).match(/(^|[^\w.$])agent\(/g)).toBeNull();
      expect(code(name).match(/workflowLib\(\{ agent, log, name: /g)).toHaveLength(1);
    },
  );

  it.each(sources)("%s passes its own meta.name as the lib's name: a copied line would write another workflow's ledger", (name) => {
    const metaName = /^export const meta = \{\s*name: ['"]([^'"]+)['"]/.exec(source(name))?.[1];
    expect(metaName).toBe(name);
    expect(source(name)).toMatch(new RegExp(`workflowLib\\(\\{ agent, log, name: ['"]${name}['"] \\}\\)`));
  });
});

describe("runSummaryNote", () => {
  it("puts the slug and the workflow in their own slots: swapped arguments would send the main thread to the wrong run", () => {
    expect(runSummaryNote("demo-slug", "ship-feature")).toBe(
      "The page also shows the run summary: the output of `bun scripts/run-telemetry.ts summary demo-slug`, run from ROOT. Tokens and seconds read n/a until `bun scripts/run-telemetry.ts ingest demo-slug ship-feature <this run's transcript directory>` has run; run it first when you have the directory.",
    );
  });
});

describe("remember and a slug that is not kebab-case", () => {
  it.each(["x; echo steered", "Upper", "a b", "$(id)", "", "../x"])(
    "a slug of %j makes no runner call and logs one line: it would otherwise reach a shell line",
    async (slug) => {
      const { lib, calls, logs } = wired(async () => "r");
      expect(await lib.asker("P").remember(slug, { log: "x" }, "memory:record:demo", "Brief")).toBeNull();
      expect(calls).toEqual([]);
      expect(logs).toEqual(["Memory and run ledger: not written, slug is not kebab-case"]);
    },
  );
});
