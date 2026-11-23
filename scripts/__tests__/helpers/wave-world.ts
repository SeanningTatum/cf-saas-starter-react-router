import { join } from "node:path";
import type { GhResult, GhRunner } from "../../lib/gh";
import { INTO, SHA_A, SHA_B, WAVE } from "../../lib/__tests__/helpers/wave-fixture";
import { type Deps, type Outcome, run } from "../../wave";
import { expect } from "vitest";

export const ROOT = "/repo";
export const SLUG = "wave-two";
export const STATE = join(ROOT, ".verify", SLUG, "wave.json");
export const PASS = [{ name: "unit", status: "COMPLETED", conclusion: "SUCCESS" }];
export const RED = [{ name: "unit", status: "COMPLETED", conclusion: "FAILURE" }];
export const RUNNING = [{ name: "unit", status: "IN_PROGRESS", conclusion: null }];
const PLAN_FLAGS = ["--wave", WAVE, "--into", INTO, "--tracks", "2", "--review-rounds", "1"];
export const TICKETS = [
  { n: 11, title: "Billing schema", kind: "build", blockedBy: [], files: ["app/lib/billing.ts"], wide: false },
  { n: 12, title: "Billing page", kind: "build", blockedBy: [11], files: ["app/lib/billing.ts"], wide: false },
  { n: 13, title: "Docs", kind: "mechanical", blockedBy: [], files: ["docs/billing.md"], wide: false },
];

export interface Pr {
  state: string;
  base: string;
  head: string;
  mergeable: string;
  checks: unknown[];
  threads: unknown[];
  refuse: string;
}

export function world() {
  const files = new Map<string, string>();
  const prs = new Map<number, Pr>();
  const calls: string[][] = [];
  const bodies: string[] = [];
  const edits: { n: string; body: string }[] = [];
  const slept: number[] = [];
  const afterSleep: (() => unknown)[] = [];
  const lists = { rollup: "" };
  let clock = 0;
  let stdin = "";
  const ok = (v: unknown): GhResult => ({ code: 0, stdout: typeof v === "string" ? v : JSON.stringify(v), stderr: "" });
  const no = (stderr: string): GhResult => ({ code: 1, stdout: "", stderr });
  const threads = (args: string[]): GhResult => {
    const pr = prs.get(Number(args.find((x) => x.startsWith("pr="))?.slice(3)));
    return ok({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: pr?.threads ?? [] } } } } });
  };
  const merge = (pr: Pr): GhResult => {
    if (pr.refuse) return no(pr.refuse);
    pr.state = "MERGED";
    return ok("");
  };
  const onPr = (verb: string, pr: Pr, n: string | undefined): GhResult | null => {
    if (verb === "view")
      return ok({
        state: pr.state,
        baseRefName: pr.base,
        headRefName: `w/${Number(n) - 100}`,
        isCrossRepository: false,
        headRefOid: pr.head,
        mergeable: pr.mergeable,
        statusCheckRollup: pr.checks,
      });
    return verb === "merge" ? merge(pr) : null;
  };
  const prCall = (args: string[], input: string | undefined): GhResult | null => {
    const [, verb = "", n] = args;
    if (verb === "list") return ok(lists.rollup);
    if (verb === "edit") {
      edits.push({ n: n ?? "", body: input ?? "" });
      return ok("");
    }
    if (verb === "create") {
      bodies.push(input ?? "");
      return ok("https://github.com/acme/saas/pull/900\n");
    }
    const pr = prs.get(Number(n));
    return pr ? onPr(verb, pr, n) : no(`no pull request ${n}`);
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
    createExclusive: (p) => !files.has(p) && Boolean(files.set(p, "lock")),
    remove: (p) => void files.delete(p),
    gh,
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
      await afterSleep.shift()?.();
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
    deps,
    files,
    prs,
    calls,
    bodies,
    edits,
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
