import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { GhResult, GhRunner } from "../lib/gh";
import { INTO, SHA_A, SHA_B, WAVE } from "../lib/__tests__/helpers/wave-fixture";
import { type Deps, type Outcome, run } from "../wave";

const ROOT = "/repo";
const SLUG = "wave-two";
const STATE = join(ROOT, ".verify", SLUG, "wave.json");
const PASS = [{ name: "unit", status: "COMPLETED", conclusion: "SUCCESS" }];
const RED = [{ name: "unit", status: "COMPLETED", conclusion: "FAILURE" }];
const RUNNING = [{ name: "unit", status: "IN_PROGRESS", conclusion: null }];
const PLAN_FLAGS = ["--wave", WAVE, "--into", INTO, "--tracks", "2", "--review-rounds", "1"];
const TICKETS = [
  { n: 11, title: "Billing schema", kind: "build", blockedBy: [], files: ["app/lib/billing.ts"], wide: false },
  { n: 12, title: "Billing page", kind: "build", blockedBy: [11], files: ["app/lib/billing.ts"], wide: false },
  { n: 13, title: "Docs", kind: "mechanical", blockedBy: [], files: ["docs/billing.md"], wide: false },
];

interface Pr {
  state: string;
  base: string;
  head: string;
  mergeable: string;
  checks: unknown[];
  threads: unknown[];
  refuse: string;
}

function world() {
  const files = new Map<string, string>();
  const prs = new Map<number, Pr>();
  const calls: string[][] = [];
  const bodies: string[] = [];
  const slept: number[] = [];
  const afterSleep: (() => void)[] = [];
  const lists = { rollup: "" };
  let clock = 0;
  let stdin = "";
  const ok = (v: unknown): GhResult => ({ code: 0, stdout: typeof v === "string" ? v : JSON.stringify(v), stderr: "" });
  const no = (stderr: string): GhResult => ({ code: 1, stdout: "", stderr });
  const threads = (args: string[]): GhResult => {
    const pr = prs.get(Number(args.find((x) => x.startsWith("pr="))?.slice(3)));
    return ok({ data: { repository: { pullRequest: { reviewThreads: { nodes: pr?.threads ?? [] } } } } });
  };
  const merge = (pr: Pr): GhResult => {
    if (pr.refuse) return no(pr.refuse);
    pr.state = "MERGED";
    return ok("");
  };
  const onPr = (verb: string, pr: Pr): GhResult | null => {
    if (verb === "view") return ok({ state: pr.state, baseRefName: pr.base, headRefOid: pr.head, mergeable: pr.mergeable, statusCheckRollup: pr.checks });
    return verb === "merge" ? merge(pr) : null;
  };
  const prCall = (args: string[], input: string | undefined): GhResult | null => {
    const [, verb = "", n] = args;
    if (verb === "list") return ok(lists.rollup);
    if (verb === "create") {
      bodies.push(input ?? "");
      return ok("https://github.com/acme/saas/pull/900\n");
    }
    const pr = prs.get(Number(n));
    return pr ? onPr(verb, pr) : no(`no pull request ${n}`);
  };
  const gh: GhRunner = (args, input) => {
    calls.push(args);
    if (args[0] === "repo") return ok("acme/saas\n");
    if (args[0] === "api") return threads(args);
    const answer = args[0] === "pr" ? prCall(args, input) : null;
    return answer ?? no(`unexpected gh ${args.join(" ")}`);
  };
  const deps: Deps = {
    root: ROOT,
    readStdin: () => stdin,
    readFile: (p) => files.get(p) ?? null,
    writeFile: (p, t) => void files.set(p, t),
    mkdirp: () => undefined,
    gh,
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
      afterSleep.shift()?.();
    },
    now: () => clock,
  };
  const cli = (argv: string[], input = ""): Promise<Outcome> => {
    stdin = input;
    return run(argv, deps);
  };
  const out = async (argv: string[], input = "") => {
    const o = await cli(argv, input);
    expect(o.stderr).toEqual([]);
    return JSON.parse(o.stdout[0] ?? "").out;
  };
  const pr = (n: number): Pr => prs.get(n) ?? expect.fail(`no PR ${n}`);
  const w = {
    files,
    prs,
    calls,
    bodies,
    slept,
    afterSleep,
    lists,
    cli,
    out,
    pr,
    state: () => JSON.parse(files.get(STATE) ?? "null"),
    ticket: (n: number) => JSON.parse(files.get(STATE) ?? "null").tickets.find((t: { n: number }) => t.n === n),
    step: async () => (await out(["next", SLUG])).step,
    merges: () => calls.filter((x) => x[0] === "pr" && x[1] === "merge").map((x) => x[2]),
    plan: async (tickets: unknown[] = TICKETS, flags = PLAN_FLAGS) => cli(["plan", SLUG, ...flags], JSON.stringify({ tickets })),
    approved: async () => {
      await w.plan();
      await cli(["approve", SLUG]);
      await w.step();
    },
    open: async (n: number, over: Partial<Pr> = {}) => {
      prs.set(100 + n, { state: "OPEN", base: WAVE, head: SHA_B, mergeable: "MERGEABLE", checks: PASS, threads: [], refuse: "", ...over });
      return out(["event", SLUG], JSON.stringify({ type: "opened", n, pr: 100 + n, branch: `w/${n}`, head: SHA_A, ownerSteps: [] }));
    },
    review: (n: number, blocking: string[] = []) => out(["event", SLUG], JSON.stringify({ type: "reviewed", n, blocking })),
    guard: (n: number, ...flags: string[]) => out(["guard", SLUG, String(n), ...flags]),
    green: async (...ns: number[]) => {
      for (const n of ns) {
        await w.open(n);
        await w.review(n);
        await w.guard(n);
      }
    },
  };
  return w;
}

describe("wave CLI", () => {
  it("walks plan, approval, two batches, merges, gates and the roll-up, and never merges the roll-up PR", async () => {
    const w = world();
    expect(JSON.parse((await w.plan()).stdout[0] ?? "").out).toEqual({
      tracks: [
        { id: "t1", tickets: [11, 12] },
        { id: "t2", tickets: [13] },
      ],
      batches: [[11, 13], [12]],
      notes: [],
    });
    expect(await w.step()).toEqual({ kind: "stop", stop: "plan", pr: null });
    expect(await w.out(["approve", SLUG])).toEqual({ approved: true });
    expect(await w.step()).toMatchObject({
      kind: "tickets",
      batch: 0,
      tickets: [
        { n: 11, step: "build" },
        { n: 13, step: "build" },
      ],
    });
    await w.open(11);
    await w.open(13);
    expect(await w.step()).toMatchObject({
      kind: "tickets",
      tickets: [
        { n: 11, step: "review", round: 1 },
        { n: 13, step: "review" },
      ],
    });
    await w.review(11);
    await w.review(13);
    expect(await w.guard(11)).toMatchObject({ guard: { verdict: "green" }, ticket: { status: "green" } });
    await w.guard(13);
    expect(await w.step()).toEqual({ kind: "merge", batch: 0 });
    expect(await w.out(["merge", SLUG])).toEqual({ merged: [11, 13], refused: [], halt: null, paused: false });
    expect(w.calls).toContainEqual(["pr", "merge", "111", "--squash", "--match-head-commit", SHA_B]);
    expect(await w.step()).toEqual({ kind: "gate", batch: 0 });
    expect(await w.out(["gate", SLUG, "--head", SHA_A, "--code", "0"])).toEqual({ gate: "pass", failures: 0, tail: "" });
    expect(await w.step()).toMatchObject({ kind: "tickets", batch: 1, tickets: [{ n: 12, step: "build" }] });
    await w.green(12);
    expect(await w.step()).toEqual({ kind: "merge", batch: 1 });
    await w.out(["merge", SLUG]);
    expect(await w.step()).toEqual({ kind: "gate", batch: 1 });
    await w.out(["gate", SLUG, "--head", SHA_A, "--code", "0"]);
    expect(await w.step()).toEqual({ kind: "rollup" });
    expect(await w.out(["rollup", SLUG, "--title", "v3.0 wave 2"])).toEqual({ pr: 900 });
    expect(w.calls).toContainEqual(["pr", "create", "--base", INTO, "--head", WAVE, "--title", "v3.0 wave 2", "--body-file", "-"]);
    expect(w.bodies[0]).toContain("never merges it");
    expect(await w.step()).toEqual({ kind: "stop", stop: "rollup", pr: 900 });
    expect(await w.step()).toEqual({ kind: "stop", stop: "rollup", pr: 900 });
    expect(w.merges()).toEqual(["111", "113", "112"]);
  });

  it("rollup reuses an open roll-up PR instead of opening a second, and still never merges it", async () => {
    const w = world();
    await w.approved();
    w.lists.rollup = "77\n";
    expect(await w.out(["rollup", SLUG, "--title", "v3.0 wave 2"])).toEqual({ pr: 77 });
    expect(w.calls.some((x) => x[1] === "create")).toBe(false);
    expect(w.state().rollupPr).toBe(77);
    expect(w.merges()).toEqual([]);
  });

  it("merge re-reads each PR and never calls gh pr merge on one retargeted off the wave branch or turned red", async () => {
    const w = world();
    await w.approved();
    await w.green(11, 13);
    w.pr(111).base = INTO;
    w.pr(113).checks = RED;
    expect(await w.out(["merge", SLUG])).toEqual({ merged: [], refused: [], halt: null, paused: false });
    expect(w.merges()).toEqual([]);
    expect(w.ticket(11)).toMatchObject({ status: "stuck", why: `the PR's base is ${INTO}, not the wave branch ${WAVE}` });
    expect(w.ticket(13)).toMatchObject({ status: "open", needsCheckFix: true });
  });

  it("guard never reports green over an unanswered thread, a red check or a pending list", async () => {
    const w = world();
    await w.approved();
    await w.open(11, { threads: [{ isResolved: false, comments: { nodes: [{ author: { login: "bot" }, url: "https://x/t1" }] } }] });
    await w.review(11);
    expect(await w.guard(11)).toMatchObject({ guard: { verdict: "threads", unanswered: ["https://x/t1"] }, ticket: { step: "answer-threads" } });
    await w.open(13, { checks: RED });
    await w.review(13);
    expect(await w.guard(13)).toMatchObject({ guard: { verdict: "red" }, ticket: { step: "fix-check" } });
    w.pr(113).checks = RUNNING;
    expect(await w.guard(13)).toMatchObject({ guard: { verdict: "pending" }, ticket: { status: "open" } });
    expect(w.slept).toEqual([]);
  });

  it("guard --wait polls while checks run and stops once they pass", async () => {
    const w = world();
    await w.approved();
    await w.open(11, { checks: RUNNING });
    await w.review(11);
    w.afterSleep.push(() => {
      w.pr(111).checks = PASS;
    });
    expect(await w.guard(11, "--wait", "120")).toMatchObject({ guard: { verdict: "green" } });
    expect(w.slept).toEqual([30_000]);
  });

  it("a merge conflict sends the ticket back for a refresh without calling gh pr merge; a second refusal sticks it", async () => {
    const w = world();
    await w.approved();
    await w.green(11);
    await w.open(13);
    w.pr(111).mergeable = "CONFLICTING";
    await w.cli(["event", SLUG], JSON.stringify({ type: "failed", n: 13, line: "cannot build the docs" }));
    expect(await w.out(["merge", SLUG])).toMatchObject({ merged: [], refused: [{ n: 11, why: "conflicts with the wave branch" }] });
    expect(w.merges()).toEqual([]);
    expect(await w.step()).toMatchObject({ kind: "tickets", tickets: [{ n: 11, step: "refresh" }] });
    await w.out(["event", SLUG], JSON.stringify({ type: "fixed", n: 11, what: "refresh", head: SHA_B }));
    w.pr(111).mergeable = "MERGEABLE";
    w.pr(111).refuse = "Head branch is out of date";
    await w.guard(11);
    expect(await w.out(["merge", SLUG])).toMatchObject({ refused: [{ n: 11, why: "Head branch is out of date" }] });
    expect(w.ticket(11)).toMatchObject({ status: "stuck", why: "could not merge after 2 tries: Head branch is out of date" });
    expect(await w.step()).toMatchObject({ kind: "stop", stop: "stuck", tickets: [{ n: 11 }, { n: 13 }] });
  });

  it("a red gate runs again once, then stops the wave with its log; resume lets it run again", async () => {
    const w = world();
    await w.approved();
    await w.green(11, 13);
    await w.out(["merge", SLUG]);
    w.files.set("/repo/gate.log", `${Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n")}\n`);
    const gate = ["gate", SLUG, "--head", SHA_A, "--code", "1", "--log", "/repo/gate.log"];
    const first = await w.out(gate);
    expect(first).toMatchObject({ gate: "fail", failures: 1 });
    expect(first.tail.split("\n")).toHaveLength(15);
    expect(first.tail.endsWith("line 19")).toBe(true);
    expect(await w.step()).toEqual({ kind: "gate", batch: 0 });
    await w.out(gate);
    expect(await w.step()).toEqual({ kind: "stop", stop: "gate", batch: 0, log: "/repo/gate.log" });
    expect((await w.cli(["resume", SLUG])).stdout).toEqual([`wave: ${SLUG} resumed; start the workflow again with the same args`]);
    expect(await w.step()).toEqual({ kind: "gate", batch: 0 });
  });

  it("pause then next stops; resume then next carries on with the same batch", async () => {
    const w = world();
    await w.approved();
    await w.open(11);
    expect((await w.cli(["pause", SLUG])).code).toBe(0);
    expect(w.state().paused).toBe(true);
    expect(await w.step()).toEqual({ kind: "stop", stop: "paused", pr: null });
    await w.cli(["resume", SLUG]);
    expect(await w.step()).toMatchObject({
      kind: "tickets",
      batch: 0,
      tickets: [
        { n: 11, step: "review" },
        { n: 13, step: "build" },
      ],
    });
  });

  it("the same failure in two tracks halts the wave through the state file, and resume clears it", async () => {
    const w = world();
    await w.approved();
    await w.out(["event", SLUG], JSON.stringify({ type: "fixed", n: 11, what: "check", head: SHA_B, cause: "D1 binding missing at /a/x.ts:4" }));
    const halted = await w.out(["event", SLUG], JSON.stringify({ type: "fixed", n: 13, what: "check", head: SHA_B, cause: "D1 binding missing at /b/x.ts:9" }));
    expect(halted.halt).toEqual({ signature: "d0 binding missing at …/x.ts:0", tickets: [11, 13] });
    expect(await w.step()).toMatchObject({ kind: "stop", stop: "shared-failure", tickets: [11, 13] });
    await w.cli(["resume", SLUG]);
    expect(w.state().halt).toBeNull();
    expect(await w.step()).toMatchObject({ kind: "tickets", batch: 0 });
  });

  it("plan refuses a blocker loop and writes no state", async () => {
    const w = world();
    const loop = [
      { ...TICKETS[0], blockedBy: [13] },
      { ...TICKETS[2], blockedBy: [11] },
    ];
    expect(await w.plan(loop)).toEqual({ code: 1, stdout: [], stderr: ["wave: tickets #11, #13 block each other; break the loop before planning"] });
    expect(w.files.size).toBe(0);
  });

  it("plan notes an unknown blocker, and an approved plan cannot be planned again", async () => {
    const w = world();
    const made = await w.plan([{ ...TICKETS[2], blockedBy: [99] }]);
    expect(JSON.parse(made.stdout[0] ?? "").out.notes).toEqual(["#13 is blocked by #99, which is not in this wave: treated as done"]);
    await w.cli(["approve", SLUG]);
    expect((await w.plan()).stderr).toEqual(["wave: the plan is approved and cannot change; edit the state with retry or skip instead"]);
  });

  it("bad arguments are usage errors and a missing state is a plain error, before any gh call", async () => {
    const w = world();
    expect((await w.plan(TICKETS, ["--wave", WAVE, "--into", WAVE, "--tracks", "2", "--review-rounds", "1"])).code).toBe(1);
    expect((await w.plan(TICKETS, ["--wave", WAVE, "--into", INTO, "--tracks", "9", "--review-rounds", "1"])).code).toBe(2);
    expect((await w.cli(["next", "Wave Two"])).code).toBe(2);
    expect((await w.cli(["frobnicate", SLUG])).code).toBe(2);
    expect((await w.cli(["next", SLUG])).stderr[0]).toBe(`wave: no wave state for ${SLUG}: the workflow writes it at its plan step`);
    await w.approved();
    expect((await w.cli(["gate", SLUG, "--head", "abc1234", "--code", "0"])).code).toBe(2);
    expect((await w.cli(["guard", SLUG])).code).toBe(2);
    expect((await w.cli(["guard", SLUG, "11"])).stderr).toEqual(["wave: #11 has no PR in this wave"]);
    expect((await w.cli(["event", SLUG], JSON.stringify({ type: "failed", n: 42, line: "x" }))).stderr).toEqual(["wave: #42 is not in this wave"]);
    expect(w.calls).toEqual([]);
  });

  it("a gh failure during guard exits 3 and leaves the state file as it was", async () => {
    const w = world();
    await w.approved();
    await w.open(11);
    w.prs.delete(111);
    const before = w.files.get(STATE);
    expect(await w.cli(["guard", SLUG, "11"])).toEqual({ code: 3, stdout: [], stderr: ["wave: gh pr view 111: no pull request 111"] });
    expect(w.files.get(STATE)).toBe(before);
  });
});
