import { join } from "node:path";
import type { GhResult, GhRunner } from "../../lib/gh";
import { type AnswerInput, type AnswerRule, configLine, RUN_OK } from "../../lib/workflow-dry-run";
import { type Deps, run } from "../../wave";

const ROOT = "/work/repo";
export const WAVE = "v3/wave-2";
const INTO = "release/v3.0";
export const SLUG = "v3-wave-2";
export const ROLLUP_PR = 900;
export const ARGS = { wave: WAVE, into: INTO, tickets: [11, 12, 13] };
export const APPROVED = { ...ARGS, plan: { approved: true } };
const STATE_FILE = join(ROOT, ".verify", SLUG, "wave.json");
export const MODELS = { plan: "opus", design: "opus", build: "sonnet", review: "sonnet", mechanical: "haiku" };
const GREEN = [{ name: "unit", status: "COMPLETED", conclusion: "SUCCESS" }];
export const RED = [{ name: "unit", status: "COMPLETED", conclusion: "FAILURE" }];
export const OPEN_THREAD = {
  isResolved: false,
  comments: { pageInfo: { hasNextPage: false }, nodes: [{ author: { login: "greptile-apps" }, url: "https://x/thread/1" }] },
};
export const ANSWERED_THREAD = {
  isResolved: false,
  comments: {
    pageInfo: { hasNextPage: false },
    nodes: [
      { author: { login: "greptile-apps" }, url: "https://x/thread/1" },
      { author: { login: "wave-bot" }, url: "https://x/thread/2" },
    ],
  },
};

const PLANNED = [
  { n: 11, title: "Billing schema", kind: "build", blockedBy: [], files: ["src/billing/"], wide: false },
  { n: 12, title: "Billing page", kind: "design", blockedBy: [], files: ["src/pages/billing.tsx"], wide: false },
  { n: 13, title: "Billing emails", kind: "build", blockedBy: [11], files: ["src/billing/email.ts"], wide: false },
];

export interface Pr {
  state: string;
  base: string;
  head: string;
  mergeable: string;
  checks: unknown[];
  threads: unknown[];
}

const sha = (n: number, k: number) => `${String(n).padStart(4, "0")}${String(k).padStart(4, "0")}`.padEnd(40, "a");

export function world() {
  const files = new Map<string, string>();
  const prs = new Map<number, Pr>();
  const gh: string[] = [];
  let stdin = "";
  const ok = (v: unknown): GhResult => ({ code: 0, stdout: typeof v === "string" ? v : JSON.stringify(v), stderr: "" });
  const runner: GhRunner = (args) => {
    gh.push(args.join(" "));
    if (args[0] === "repo") return ok("o/r\n");
    if (args[0] === "api") {
      const pr = prs.get(Number(args.find((a) => a.startsWith("pr="))?.slice(3)));
      return ok({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: pr?.threads ?? [] } } } } });
    }
    const [, verb, n] = args;
    if (verb === "list") return ok("");
    if (verb === "create") return ok(`https://github.com/o/r/pull/${ROLLUP_PR}\n`);
    const pr = prs.get(Number(n));
    if (!pr) return { code: 1, stdout: "", stderr: `no PR ${n}` };
    if (verb === "merge") {
      pr.state = "MERGED";
      return ok("");
    }
    return ok({
      state: pr.state,
      baseRefName: pr.base,
      headRefName: `${WAVE}-${Number(n) - 100}-work`,
      isCrossRepository: false,
      headRefOid: pr.head,
      mergeable: pr.mergeable,
      statusCheckRollup: pr.checks,
    });
  };
  const deps: Deps = {
    root: ROOT,
    readStdin: () => stdin,
    readFile: (p) => files.get(p) ?? null,
    writeFile: (p, t) => void files.set(p, t),
    mkdirp: () => undefined,
    createExclusive: (p) => !files.has(p) && Boolean(files.set(p, "lock")),
    remove: (p) => void files.delete(p),
    gh: runner,
    sleep: async () => undefined,
    now: () => 0,
  };
  const cli = async (argv: string[], input = "") => {
    stdin = input;
    return run(argv, deps);
  };
  const state = () => JSON.parse(files.get(STATE_FILE) ?? "null");
  const openPr = (n: number, over: Partial<Pr> = {}) => {
    const pr: Pr = { state: "OPEN", base: WAVE, head: sha(n, 1), mergeable: "MERGEABLE", checks: GREEN, threads: [], ...over };
    prs.set(100 + n, pr);
    return pr;
  };
  return { files, prs, gh, cli, state, openPr, sha };
}

export type World = ReturnType<typeof world>;

const shellWords = (text: string): string[] =>
  [...text.matchAll(/'((?:[^']|'\\'')*)'|(\S+)/g)].map((m) => (m[1] !== undefined ? m[1].split("'\\''").join("'") : (m[2] ?? "")));

async function runWave(w: World, prompt: string) {
  const m = /bun scripts\/wave\.ts ([^\n]*?)(?: <<'WAVE_EOF'\n([\s\S]*?)\nWAVE_EOF)?$/.exec(prompt);
  if (!m) throw new Error(`no wave command in: ${prompt.slice(-200)}`);
  const o = await w.cli(shellWords(m[1] ?? ""), m[2] ?? "");
  return o.code === 0 ? { ok: true, out: o.stdout.at(-1) ?? "" } : { ok: false, out: o.stderr.join(" ") };
}

export const ticketOf = (label: string): number => Number(label.split(":")[0]);
export const stepOf = (label: string): string => label.split(":").at(-1) ?? "";

export interface Script {
  build?: (n: number, call: AnswerInput) => unknown;
  review?: (n: number, call: AnswerInput) => unknown;
  fix?: (n: number, step: string, call: AnswerInput) => unknown;
  gate?: (call: AnswerInput) => number;
}

const built = (w: World, n: number) => {
  const pr = w.openPr(n);
  return {
    ok: true,
    pr: 100 + n,
    branch: `${WAVE}-${n}-work`,
    head: pr.head,
    owner_steps: n === 12 ? ["Set the BILLING_KEY secret in the dashboard"] : [],
    error_line: "",
    summary: "done",
  };
};

export function answers(w: World, s: Script = {}, over: AnswerRule[] = []): AnswerRule[] {
  return [
    ...over,
    ["config", { ok: true, reason: "", config_json: configLine() }],
    ["preflight", { ok: true, reason: "", root: ROOT, default_branch: "staging", into: INTO }],
    ["plan", { tickets: PLANNED }],
    [/^(memory|run:record)/, (c: AnswerInput) => (c.label.startsWith("run:") ? RUN_OK : "memory: recorded")],
    [
      /^wave:gate:/,
      async (c: AnswerInput) => {
        const code = s.gate ? s.gate(c) : 0;
        const o = await w.cli(["gate", SLUG, "--head", "f".repeat(40), "--code", String(code)]);
        return { ok: o.code === 0, out: o.stdout.at(-1) ?? o.stderr.join(" ") };
      },
    ],
    [(c) => c.opts.agentType === "runner" && c.prompt.includes("bun scripts/wave.ts"), (c: AnswerInput) => runWave(w, c.prompt)],
    [/:build$/, (c: AnswerInput) => (s.build ? s.build(ticketOf(c.label), c) : built(w, ticketOf(c.label)))],
    [/:review$/, (c: AnswerInput) => (s.review ? s.review(ticketOf(c.label), c) : { findings: [] })],
    [
      /:(fix-review|fix-check|answer-threads|refresh)$/,
      (c: AnswerInput) => (s.fix ? s.fix(ticketOf(c.label), stepOf(c.label), c) : { ok: true, head: w.sha(ticketOf(c.label), 2), cause: "", error_line: "" }),
    ],
  ];
}

export { built };
