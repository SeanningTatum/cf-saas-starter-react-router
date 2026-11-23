import { describe, expect, it } from "vitest";
import { type AgentCall, type DryRunResult, dryRun, labels } from "../../lib/workflow-dry-run";
import { APPROVED, ARGS, ANSWERED_THREAD, answers, built, MODELS, OPEN_THREAD, RED, ROLLUP_PR, SLUG, stepOf, ticketOf, WAVE, world } from "./run-wave.fixtures";

const merges = (w: ReturnType<typeof world>) => w.gh.filter((g) => g.startsWith("pr merge"));
const steps = (r: DryRunResult, step: string) => r.calls.filter((c) => stepOf(c.label) === step);
const ticketCalls = (r: DryRunResult, n: number) => r.calls.filter((c) => /^\d+:/.test(c.label) && ticketOf(c.label) === n && !c.label.endsWith(":event"));
const firstIndex = (calls: AgentCall[], test: (c: AgentCall) => boolean) => calls.findIndex(test);

async function planned(w = world()) {
  const stopped = await dryRun("run-wave", { args: ARGS, answers: answers(w) });
  return { w, stopped };
}

describe("run-wave: plan stop", () => {
  it("returns a plan page before it builds anything (catches a build or a GitHub write moved ahead of the person's approval)", async () => {
    const { w, stopped } = await planned();
    expect(stopped.result).toMatchObject({ status: "needs-plan", review: `.verify/${SLUG}/plan.html` });
    expect(labels(stopped.calls)).not.toContainEqual(expect.stringMatching(/:build$/));
    expect(w.gh).toEqual([]);
    expect(w.state()).toMatchObject({ planApproved: false, projected: [[11, 12], [13]] });
    expect(stopped.calls.find((c) => c.label === "plan")?.opts.model).toBe(MODELS.plan);
  });

  it("an approval in args never approves a plan the person has not seen: a run that had to plan stops again", async () => {
    const w = world();
    const r = await dryRun("run-wave", { args: APPROVED, answers: answers(w) });
    expect(r.result).toMatchObject({ status: "needs-plan" });
    expect(w.state().planApproved).toBe(false);
  });

  it("changes asked on the plan page re-run the planner with them, fenced as data, and stop for a new look", async () => {
    const { w } = await planned();
    const r = await dryRun("run-wave", { args: { ...ARGS, plan: { approved: false, changes: "Put #13 first" } }, answers: answers(w) });
    expect(r.result).toMatchObject({ status: "needs-plan" });
    expect(r.calls.find((c) => c.label === "plan")?.prompt).toContain("----- DATA: changes -----\nPut #13 first");
  });
});

describe("run-wave: a wave of two batches, approved, run to the roll-up", () => {
  const go = async () => {
    const { w } = await planned();
    const r = await dryRun("run-wave", { args: APPROVED, answers: answers(w) });
    return { w, r };
  };

  it("builds batch 1, merges it, gates it, then builds batch 2 from the new head, then stops at the roll-up it never merges", async () => {
    const { w, r } = await go();
    expect(r.result).toMatchObject({ status: "needs-rollup", pr: ROLLUP_PR });
    expect(merges(w)).toEqual([
      `pr merge 111 --merge --match-head-commit ${w.sha(11, 1)}`,
      `pr merge 112 --merge --match-head-commit ${w.sha(12, 1)}`,
      `pr merge 113 --merge --match-head-commit ${w.sha(13, 1)}`,
    ]);
    expect(w.gh.some((g) => g.includes(`merge ${ROLLUP_PR}`))).toBe(false);
    const gates = r.calls.filter((c) => c.label.startsWith("wave:gate:")).map((c) => c.n);
    expect(gates).toHaveLength(2);
    const build13 = firstIndex(r.calls, (c) => c.label.endsWith(":build") && ticketOf(c.label) === 13);
    expect(build13).toBeGreaterThan(gates[0] ?? Infinity);
    expect(w.state()).toMatchObject({ batchesDone: 2, rollupPr: ROLLUP_PR });
  });

  it("every agent after preflight, planner and reviewer included, is told the absolute ROOT, so none reads the launching checkout", async () => {
    const { w } = await planned();
    const r = await dryRun("run-wave", { args: APPROVED, answers: answers(w) });
    const later = r.calls.filter((c) => c.label !== "config" && c.label !== "preflight");
    const stray = later.filter((c) => !c.prompt.startsWith("ROOT is /work/repo. cd there before anything else.")).map((c) => c.label);
    expect(stray).toEqual([]);
    expect(later.some((c) => stepOf(c.label) === "review")).toBe(true);
    const plan = (await planned()).stopped.calls.find((c) => c.label === "plan");
    expect(plan?.prompt.startsWith("ROOT is /work/repo.")).toBe(true);
  });

  it("checking and merging run as script steps on the runner, never as a model's judgment", async () => {
    const { r } = await go();
    const scriptSteps = r.calls.filter((c) => /bun scripts\/wave\.ts (guard|merge|gate)/.test(c.prompt));
    expect(scriptSteps.length).toBeGreaterThan(0);
    expect(scriptSteps.every((c) => c.opts.agentType === "runner" && c.opts.model === undefined)).toBe(true);
  });

  it("picks the model by kind of work: design ticket on the design model, other tickets on build, the review on review", async () => {
    const { r } = await go();
    const model = (n: number, step: string) => r.calls.find((c) => ticketOf(c.label) === n && stepOf(c.label) === step)?.opts.model;
    expect(model(12, "build")).toBe(MODELS.design);
    expect(model(11, "build")).toBe(MODELS.build);
    expect(model(11, "review")).toBe(MODELS.review);
  });

  it("each ticket's calls carry its track as the phase, so run-telemetry can sum tokens and time per track", async () => {
    const { r, w } = await go();
    const trackOf = (n: number) => w.state().tickets.find((t: { n: number }) => t.n === n).track;
    for (const n of [11, 12, 13]) expect(new Set(ticketCalls(r, n).map((c) => c.opts.phase))).toEqual(new Set([`Track ${trackOf(n)}`]));
    expect(trackOf(11)).toBe(trackOf(13));
    expect(trackOf(11)).not.toBe(trackOf(12));
    const ledger = r.calls.find((c) => c.label.startsWith("run:record"))?.prompt ?? "";
    expect(ledger).toContain(`Track ${trackOf(12)}`);
  });

  it("gathers the owner steps into the roll-up's state for its body", async () => {
    const { w } = await go();
    expect(w.state().tickets.find((t: { n: number }) => t.n === 12).ownerSteps).toEqual(["Set the BILLING_KEY secret in the dashboard"]);
  });
});

describe("run-wave: the merge guard", () => {
  it("a PR with an unanswered review thread is not merged until the thread step answers it, on the mechanical model", async () => {
    const { w } = await planned();
    const r = await dryRun("run-wave", {
      args: APPROVED,
      answers: answers(w, {
        build: (n) => {
          const out = built(w, n);
          if (n === 11) (w.prs.get(111) ?? { threads: [] }).threads = [OPEN_THREAD];
          return out;
        },
        fix: (n, step) => {
          if (step === "answer-threads") (w.prs.get(100 + n) ?? { threads: [] }).threads = [ANSWERED_THREAD];
          return { ok: true, head: w.sha(n, 2), cause: "", error_line: "" };
        },
      }),
    });
    const threads = steps(r, "answer-threads");
    expect(threads.map((c) => ticketOf(c.label))).toEqual([11]);
    expect(threads[0]?.opts.model).toBe(MODELS.mechanical);
    const mergeAt = firstIndex(r.calls, (c) => c.label.startsWith("wave:merge:"));
    expect(mergeAt).toBeGreaterThan(threads[0]?.n ?? Infinity);
    expect(r.result).toMatchObject({ status: "needs-rollup" });
  });

  it("a red check gets one fix; red twice makes the track stuck: the batch's green PR still merges and gates, then the run stops for you", async () => {
    const { w } = await planned();
    const r = await dryRun("run-wave", {
      args: APPROVED,
      answers: answers(w, {
        build: (n) => {
          const out = built(w, n);
          if (n === 12) (w.prs.get(112) ?? { checks: [] }).checks = RED;
          return out;
        },
      }),
    });
    expect(r.result).toMatchObject({ status: "needs-help", reason: "stuck", tickets: [{ n: 12, pr: 112 }] });
    expect(steps(r, "fix-check").map((c) => ticketOf(c.label))).toEqual([12]);
    expect(merges(w)).toEqual([`pr merge 111 --merge --match-head-commit ${w.sha(11, 1)}`]);
    expect(r.calls.filter((c) => c.label.startsWith("wave:gate:"))).toHaveLength(1);
    expect(r.calls.at(-1)?.label).toMatch(/^memory:stuck:/);
  });

  it("after a skip, a fresh run goes on from the state file without rebuilding what merged", async () => {
    const { w } = await planned();
    const red = answers(w, {
      build: (n) => {
        const out = built(w, n);
        if (n === 12) (w.prs.get(112) ?? { checks: [] }).checks = RED;
        return out;
      },
    });
    await dryRun("run-wave", { args: APPROVED, answers: red });
    expect((await w.cli(["skip", SLUG, "12"])).code).toBe(0);
    const again = await dryRun("run-wave", { args: APPROVED, answers: answers(w) });
    expect(again.result).toMatchObject({ status: "needs-rollup" });
    expect(steps(again, "build").map((c) => ticketOf(c.label))).toEqual([13]);
    expect(merges(w).some((g) => g.startsWith("pr merge 112"))).toBe(false);
  });
});

describe("run-wave: a shared failure", () => {
  it("the same error in two tracks pauses every track and reports once: no merge, no gate, one memory record", async () => {
    const { w } = await planned();
    const r = await dryRun("run-wave", {
      args: APPROVED,
      answers: answers(w, {
        build: (n) => ({
          ok: false,
          pr: 0,
          branch: "",
          head: "",
          owner_steps: [],
          error_line: `fatal: bad config line 1 in file /tmp/wt-${n}/.git/config`,
          summary: "",
        }),
      }),
    });
    expect(r.result).toMatchObject({ status: "needs-help", reason: "shared-failure", tickets: [11, 12] });
    expect(r.calls.some((c) => /^wave:(merge|gate):/.test(c.label))).toBe(false);
    expect(r.calls.filter((c) => c.label.startsWith("memory:"))).toHaveLength(1);
    expect(w.gh).toEqual([]);
  });

  it("after resume, the halted tickets are built again from the state file, not stuck", async () => {
    const { w } = await planned();
    const failing = answers(w, {
      build: () => ({ ok: false, pr: 0, branch: "", head: "", owner_steps: [], error_line: "fatal: bad config line 1", summary: "" }),
    });
    await dryRun("run-wave", { args: APPROVED, answers: failing });
    expect((await w.cli(["resume", SLUG])).code).toBe(0);
    const again = await dryRun("run-wave", { args: APPROVED, answers: answers(w) });
    expect(again.result).toMatchObject({ status: "needs-rollup" });
    expect(steps(again, "build").map((c) => ticketOf(c.label))).toEqual([11, 12, 13]);
  });
});

describe("run-wave: pause and resume", () => {
  it("a pause mid-batch stops the run at the next step; resume picks up where it stopped and never rebuilds a ticket that opened its PR", async () => {
    const { w } = await planned();
    const pausing = answers(w, {
      build: async (n) => {
        const out = built(w, n);
        if (n === 11) await w.cli(["pause", SLUG]);
        return out;
      },
    });
    const first = await dryRun("run-wave", { args: APPROVED, answers: pausing });
    expect(first.result).toMatchObject({ status: "paused" });
    expect(merges(w)).toEqual([]);
    const status = await w.cli(["status", SLUG]);
    expect(status.stdout.join("\n")).toContain("PAUSED");
    expect((await w.cli(["resume", SLUG])).code).toBe(0);
    const second = await dryRun("run-wave", { args: APPROVED, answers: answers(w) });
    expect(second.result).toMatchObject({ status: "needs-rollup" });
    expect(steps(second, "build").map((c) => ticketOf(c.label))).toEqual([13]);
  });

  it("a run that dies mid-batch resumes from the last finished step on a fresh start", async () => {
    const { w } = await planned();
    const dying = answers(w, {
      review: () => {
        throw new Error("agent died");
      },
    });
    const first = await dryRun("run-wave", { args: APPROVED, answers: dying });
    expect(first.result).toMatchObject({ stopped: "Build" });
    const second = await dryRun("run-wave", { args: APPROVED, answers: answers(w) });
    expect(second.result).toMatchObject({ status: "needs-rollup" });
    expect(steps(second, "build").map((c) => ticketOf(c.label))).toEqual([13]);
    expect(
      steps(second, "review")
        .map((c) => ticketOf(c.label))
        .sort(),
    ).toEqual([11, 12, 13]);
  });
});

describe("run-wave: args and settings", () => {
  it("refuses args with no wave branch or no tickets before any agent runs", async () => {
    const w = world();
    const noWave = await dryRun("run-wave", { args: { tickets: [1] }, answers: answers(w) });
    expect(noWave.result).toMatchObject({ error: expect.stringContaining("args.wave") });
    const noTickets = await dryRun("run-wave", { args: { wave: WAVE }, answers: answers(w) });
    expect(noTickets.result).toMatchObject({ error: expect.stringContaining("args.tickets") });
    expect(noWave.calls.length + noTickets.calls.length).toBe(0);
  });

  it("refuses a wave branch that is the default branch, since the run merges PRs into it", async () => {
    const w = world();
    const r = await dryRun("run-wave", { args: { ...ARGS, wave: "staging" }, answers: answers(w) });
    expect(r.result).toMatchObject({ stopped: "Preflight", reason: expect.stringContaining("default branch") });
    expect(w.state()).toBeNull();
  });

  it("args.tracks can lower the tracks at once for one wave but never raise it past the config", async () => {
    const low = world();
    await dryRun("run-wave", { args: { ...ARGS, tracks: 1 }, answers: answers(low) });
    expect(low.state()).toMatchObject({ tracksAtOnce: 1, projected: [[11], [12], [13]] });
    const high = world();
    await dryRun("run-wave", { args: { ...ARGS, tracks: 6 }, answers: answers(high) });
    expect(high.state().tracksAtOnce).toBe(3);
  });
});
