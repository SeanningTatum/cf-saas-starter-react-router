import { describe, expect, it } from "vitest";
import { parseFields } from "../../memory";
import { type DryRunResult, dryRun } from "../../lib/workflow-dry-run";
import { APPROVED, ARGS, ANSWERED_THREAD, answers, built, MODELS, OPEN_THREAD, RED, SLUG, stepOf, ticketOf, world } from "./run-wave.fixtures";

const steps = (r: DryRunResult, step: string) => r.calls.filter((c) => stepOf(c.label) === step);

async function planned(w = world()) {
  const stopped = await dryRun("run-wave", { args: ARGS, answers: answers(w) });
  return { w, stopped };
}

const memoryFields = (r: DryRunResult) => {
  const call = r.calls.find((c) => c.label.startsWith("memory:"));
  const stdin = /<<'MEMORY_EOF'\n([\s\S]*?)\nMEMORY_EOF/.exec(call?.prompt ?? "")?.[1] ?? "";
  return parseFields(stdin);
};

describe("run-wave: fixes and trailers", () => {
  it("a merge refresh stays on the mechanical model; a review fix, a check fix and a thread answer use the ticket's build model", async () => {
    const { w } = await planned();
    const r = await dryRun("run-wave", {
      args: APPROVED,
      answers: answers(w, {
        build: (n) => {
          const out = built(w, n);
          if (n === 11) (w.prs.get(111) ?? { threads: [] }).threads = [OPEN_THREAD];
          return out;
        },
        review: (n) => (n === 12 ? { findings: [{ severity: "P1", file: "a.ts", line: 1, detail: "bug", fix: "fix it" }] } : { findings: [] }),
        fix: (n, step) => {
          if (step === "answer-threads") (w.prs.get(100 + n) ?? { threads: [] }).threads = [ANSWERED_THREAD];
          return { ok: true, head: w.sha(n, 2), cause: "", error_line: "" };
        },
      }),
    });
    const model = (step: string) => steps(r, step).map((c) => c.opts.model);
    expect(new Set(model("fix-review"))).toEqual(new Set([MODELS.design]));
    expect(new Set(model("answer-threads"))).toEqual(new Set([MODELS.build]));
    for (const m of model("refresh")) expect(m).toBe(MODELS.mechanical);
  });

  it("tells each agent to name the model it runs on in the Co-Authored-By line, not to copy the example", async () => {
    const { w } = await planned();
    const r = await dryRun("run-wave", { args: APPROVED, answers: answers(w) });
    const prompt = r.calls.find((c) => stepOf(c.label) === "build")?.prompt ?? "";
    expect(prompt).toContain("names the model you run on");
    expect(prompt).toContain("Co-Authored-By:");
  });

  it("points a human step at the root's proof folder, which outlives the worktree", async () => {
    const { w } = await planned();
    const r = await dryRun("run-wave", { args: APPROVED, answers: answers(w) });
    const prompt = r.calls.find((c) => stepOf(c.label) === "build" && ticketOf(c.label) === 12)?.prompt ?? "";
    expect(prompt).toContain(`/work/repo/.verify/${SLUG}/proof/12`);
    expect(prompt).toContain("never a path inside WT");
  });
});

describe("run-wave: the roll-up and clean-up", () => {
  const go = async (setup: (w: ReturnType<typeof world>) => void = () => undefined) => {
    const { w } = await planned();
    setup(w);
    const r = await dryRun("run-wave", { args: APPROVED, answers: answers(w) });
    return { w, r };
  };

  it("after each green batch gate, removes the merged tickets' worktrees with no force, and copies their proof first", async () => {
    const { r } = await go();
    const clean = r.calls.filter((c) => c.label.startsWith("wave:clean:"));
    expect(clean).toHaveLength(2);
    expect(clean[0]?.prompt).toContain("#11, #12");
    expect(clean[1]?.prompt).toContain("#13");
    const prompt = clean[0]?.prompt ?? "";
    expect(prompt).toContain(`cp -R WT/.verify/. /work/repo/.verify/${SLUG}/proof/N/`);
    expect(prompt.indexOf("cp -R")).toBeLessThan(prompt.indexOf("worktree remove"));
    expect(prompt).toContain("Never add --force");
    const gateAt = r.calls.findIndex((c) => c.label === `wave:gate:${clean[0]?.label.split(":")[2]}`);
    expect(gateAt).toBeLessThan(clean[0]?.n ?? -1);
  });

  it("a gate that fails removes nothing", async () => {
    const { w } = await planned();
    const r = await dryRun("run-wave", { args: APPROVED, answers: answers(w, { gate: () => 1 }) });
    expect(r.result).toMatchObject({ status: "needs-help", reason: "gate" });
    expect(r.calls.some((c) => c.label.startsWith("wave:clean:"))).toBe(false);
  });

  it("measures the size table on the gate checkout before the roll-up, passes the file to it, then removes the gate checkout", async () => {
    const { r } = await go();
    const at = (label: string) => r.calls.findIndex((c) => c.label === label);
    expect(at("wave:rollup-size")).toBeGreaterThan(-1);
    expect(at("wave:rollup-size")).toBeLessThan(at("wave:rollup"));
    expect(at("wave:rollup")).toBeLessThan(at("wave:clean-gate"));
    const size = r.calls[at("wave:rollup-size")]?.prompt ?? "";
    expect(size).toContain("bun run size --base origin/release/v3.0 --pr-body");
    expect(size).toContain("900000 ms");
    expect(r.calls[at("wave:rollup")]?.prompt).toContain(`--size-file '/work/repo/.verify/${SLUG}/size.md'`);
    expect(r.calls[at("wave:clean-gate")]?.prompt).toContain("Never add --force");
  });

  it("a second run on a wave branch with an open roll-up PR ends at needs-rollup with that PR and edits its body", async () => {
    const { w, r } = await go((world) => {
      world.open.rollup = { number: 77, body: "A person wrote this." };
    });
    expect(r.result).toMatchObject({ status: "needs-rollup", pr: 77 });
    expect(w.gh.some((g) => g.startsWith("pr create"))).toBe(false);
    expect(w.edits[0]).toMatchObject({ n: "77" });
    expect(w.edits[0]?.body.startsWith("A person wrote this.")).toBe(true);
    expect(w.edits[0]?.body).toContain("- #11 Billing schema (PR #111)");
  });

  it("the review's P2 and P3 findings are kept in the wave state and listed by status", async () => {
    const { w } = await planned();
    await dryRun("run-wave", {
      args: APPROVED,
      answers: answers(w, { review: (n) => ({ findings: [{ severity: "P3", file: "a.ts", line: 4, detail: `nit ${n}`, fix: "rename" }] }) }),
    });
    expect(w.state().tickets.find((t: { n: number }) => t.n === 11).kept).toEqual(["P3 a.ts:4 nit 11 Fix: rename"]);
    const status = await w.cli(["status", SLUG]);
    expect(status.stdout.join("\n")).toContain("#12: P3 a.ts:4 nit 12 Fix: rename");
    expect(w.state().tickets.every((t: { needsFix: boolean }) => !t.needsFix)).toBe(true);
  });
});

describe("run-wave: the memory record at each stop", () => {
  const OK = ["planned", "in-progress", "blocked", "done", "dropped"];

  it("writes a status scripts/memory.ts takes at every stop kind, and keeps the stop's name in another field", async () => {
    const seen = new Map<string, string>();
    const note = (r: DryRunResult, stop: string) => {
      const parsed = memoryFields(r);
      expect("fields" in parsed, `${stop}: ${"error" in parsed ? parsed.error : ""}`).toBe(true);
      const fields = "fields" in parsed ? parsed.fields : {};
      expect(OK).toContain(fields.status?.at(-1));
      expect(fields.stopped?.at(-1)).toContain(stop);
      seen.set(stop, fields.status?.at(-1) ?? "");
    };
    const first = await planned();
    note(first.stopped, "plan");
    const w = first.w;
    note(await dryRun("run-wave", { args: APPROVED, answers: answers(w) }), "rollup");
    const red = world();
    await dryRun("run-wave", { args: ARGS, answers: answers(red) });
    const stuck = await dryRun("run-wave", {
      args: APPROVED,
      answers: answers(red, {
        build: (n) => {
          const out = built(red, n);
          if (n === 12) (red.prs.get(112) ?? { checks: [] }).checks = RED;
          return out;
        },
      }),
    });
    note(stuck, "stuck");
    const shared = await planned();
    note(
      await dryRun("run-wave", {
        args: APPROVED,
        answers: answers(shared.w, {
          build: (n) => ({ ok: false, pr: 0, branch: "", head: "", owner_steps: [], error_line: `fatal: bad config in /tmp/wt-${n}`, summary: "" }),
        }),
      }),
      "shared-failure",
    );
    const gated = await planned();
    note(await dryRun("run-wave", { args: APPROVED, answers: answers(gated.w, { gate: () => 1 }) }), "gate");
    const pausing = await planned();
    note(
      await dryRun("run-wave", {
        args: APPROVED,
        answers: answers(pausing.w, {
          build: async (n) => {
            const out = built(pausing.w, n);
            if (n === 11) await pausing.w.cli(["pause", SLUG]);
            return out;
          },
        }),
      }),
      "paused",
    );
    expect([...seen.keys()].sort()).toEqual(["gate", "paused", "plan", "rollup", "shared-failure", "stuck"]);
  });
});
