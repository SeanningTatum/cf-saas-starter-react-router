/**
 * Stacked-PR helper for the ship-feature workflow.
 *
 *   bun run scripts/stack.ts assign  --plan <file.json>
 *   bun run scripts/stack.ts split   --plan <file.json>
 *   bun run scripts/stack.ts restack --plan <file.json> --from <n>   (needs git 2.38 for rebase --update-refs; the workflow checks)
 *
 * Plan: { base, prs: [{ n, branch, title, fence: [path | dir/], message }], rest?: n, exclude?: [path | dir/] }.
 * Excluded paths are never assigned, never unassigned and never staged; `assign` lists them as `excluded`.
 * A fence entry ending in "/" is a directory prefix; any other entry is an exact path.
 * Success prints one JSON object to stdout. Failure prints { error, code, help } to stderr.
 * Exit codes: 0 ok, 1 USAGE, 2 GIT, 3 refused, 4 CONFLICT.
 *
 * `assign` only reports: it exits 0 even with unassigned or overlapping paths, and `split` is the
 * verb that refuses on them. A renamed file counts as its new path; the old path rides along in the
 * same PR so `git add -A` stages the deletion with it.
 *
 * `git` and the file reader are injected (`Deps`), so the tests never touch a repository.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}
/** Runs `git <args>` and reports what happened. Never throws. */
export type GitRunner = (args: string[]) => GitResult;

export interface Deps {
  git: GitRunner;
  readFile: (path: string) => string;
}

export interface Outcome {
  code: number;
  out?: unknown;
  err?: { error: string; code: string; help: string };
}

export interface Pr {
  n: number;
  branch: string;
  title: string;
  fence: string[];
  message: string;
}
export interface Plan {
  base: string;
  prs: Pr[];
  rest?: number;
  /** Paths (exact, or dir/ prefix) that assign and split ignore entirely. */
  exclude?: string[];
}
export interface Assignment {
  n: number;
  branch: string;
  paths: string[];
}
export interface Assigned {
  assignments: Assignment[];
  unassigned: string[];
  overlaps: { path: string; prs: number[] }[];
  excluded: string[];
}

const ok = (out: unknown): Outcome => ({ code: 0, out });
const bad = (code: number, kind: string, error: string, help: string): Outcome => ({
  code,
  err: { error, code: kind, help },
});
const usage = (error: string): Outcome =>
  bad(1, "USAGE", error, "verbs: assign --plan <f> | split --plan <f> | restack --plan <f> --from <n>");
const gitFailure = (r: GitResult, what: string): Outcome =>
  bad(2, "GIT", `${what}: ${r.stderr.trim() || r.stdout.trim() || `git exited ${r.code}`}`, "run the same git command by hand to see why");

export const defaultDeps: Deps = {
  git: (args) => {
    const r = spawnSync("git", args, { encoding: "utf8" });
    if (r.error) return { code: 127, stdout: "", stderr: `cannot run git: ${r.error.message}` };
    return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  },
  readFile: (p) => readFileSync(p, "utf8"),
};

/** Drop "./" prefixes and doubled slashes; keep a trailing "/" (the directory marker). */
export function normalizePath(p: string): string {
  let s = p.trim().replace(/\/{2,}/g, "/");
  while (s.startsWith("./")) s = s.slice(2);
  return s;
}

// A fence with or without a trailing "/" owns its children when it names a directory: the same rule the workflow's covers() uses.
const matches = (fence: string, path: string) => (fence.endsWith("/") ? path.startsWith(fence) : path === fence || path.startsWith(`${fence}/`));

/** Changed paths from `git status --porcelain=v1 -z -uall`: NUL-separated "XY path" entries, so odd filenames arrive raw, never quoted or escaped. A rename is "XY new" then "old"; it gives the new path and records the old one. */
export function parsePorcelain(text: string): { paths: string[]; renamedFrom: Map<string, string> } {
  const paths: string[] = [];
  const renamedFrom = new Map<string, string>();
  const parts = text.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4 || entry.startsWith("!!")) continue;
    const newP = normalizePath(entry.slice(3));
    paths.push(newP);
    if (entry[0] === "R" || entry[0] === "C" || entry[1] === "R" || entry[1] === "C") {
      const oldP = parts[++i];
      if (oldP && entry[0] !== "C" && entry[1] !== "C") renamedFrom.set(newP, normalizePath(oldP));
    }
  }
  return { paths, renamedFrom };
}

/** Pure assignment of changed paths to PRs by fence. */
export function assignPaths(plan: Plan, changed: string[], renamedFrom: Map<string, string> = new Map()): Assigned {
  const oldPaths = new Set(renamedFrom.values());
  const fences = plan.prs.map((p) => ({ pr: p, fence: p.fence.map(normalizePath).filter(Boolean) }));
  const buckets = new Map<number, string[]>(plan.prs.map((p) => [p.n, []]));
  const unassigned: string[] = [];
  const excluded: string[] = [];
  const skip = (plan.exclude ?? []).map(normalizePath).filter(Boolean);
  const overlaps: Assigned["overlaps"] = [];
  const seen = new Set<string>();
  for (const raw of changed) {
    const path = normalizePath(raw);
    // A rename's old path is carried by the new path, never judged on its own.
    if (!path || seen.has(path) || oldPaths.has(path)) continue;
    seen.add(path);
    if (skip.some((e) => matches(e, path))) {
      excluded.push(path);
      continue;
    }
    const hit = fences.filter((f) => f.fence.some((e) => matches(e, path))).map((f) => f.pr.n);
    if (hit.length > 1) overlaps.push({ path, prs: hit });
    else if (hit.length === 1) buckets.get(hit[0])!.push(path);
    else if (plan.rest !== undefined && buckets.has(plan.rest)) buckets.get(plan.rest)!.push(path);
    else unassigned.push(path);
  }
  const assignments = plan.prs.map((p) => {
    const paths = buckets.get(p.n)!;
    const olds = paths.map((x) => renamedFrom.get(x)).filter((x): x is string => !!x);
    return { n: p.n, branch: p.branch, paths: [...paths, ...olds] };
  });
  return { assignments, unassigned, overlaps, excluded };
}

function loadPlan(path: string | undefined, deps: Deps): Plan | Outcome {
  if (!path) return usage("--plan is required");
  let raw: unknown;
  try {
    raw = JSON.parse(deps.readFile(path));
  } catch (e) {
    return usage(`cannot read plan ${path}: ${(e as Error).message}`);
  }
  const p = raw as Partial<Plan>;
  if (!p || typeof p.base !== "string" || !p.base) return usage("plan.base must be a branch name");
  if (!Array.isArray(p.prs) || p.prs.length === 0) return usage("plan.prs must be a non-empty array");
  for (const pr of p.prs) {
    if (typeof pr?.n !== "number" || typeof pr.branch !== "string" || !pr.branch || !Array.isArray(pr.fence) || typeof pr.message !== "string")
      return usage("each plan.prs entry needs n (number), branch, fence (array) and message");
  }
  const ns = p.prs.map((x) => x.n);
  if (new Set(ns).size !== ns.length) return usage("plan.prs has a duplicate n");
  if (p.exclude !== undefined && (!Array.isArray(p.exclude) || p.exclude.some((e) => typeof e !== "string"))) return usage("plan.exclude must be an array of strings");
  if (p.rest !== undefined && !ns.includes(p.rest)) return usage(`plan.rest ${p.rest} is not a PR in plan.prs`);
  return { ...(p as Plan), prs: [...p.prs].sort((a, b) => a.n - b.n) };
}

const isOutcome = (v: unknown): v is Outcome => typeof v === "object" && v !== null && "code" in v;

function computeAssign(plan: Plan, deps: Deps): Assigned | Outcome {
  const st = deps.git(["status", "--porcelain=v1", "-z", "-uall"]);
  if (st.code !== 0) return gitFailure(st, "git status");
  const df = deps.git(["diff", "--name-only", "-z", plan.base]);
  if (df.code !== 0) return gitFailure(df, "git diff");
  const { paths, renamedFrom } = parsePorcelain(st.stdout);
  const diffPaths = df.stdout.split("\0").map(normalizePath).filter(Boolean);
  const changed = [...new Set([...paths, ...diffPaths])];
  return assignPaths(plan, changed, renamedFrom);
}

function split(plan: Plan, deps: Deps): Outcome {
  const a = computeAssign(plan, deps);
  if (isOutcome(a)) return a;
  if (a.unassigned.length)
    return bad(3, "DIRTY_UNASSIGNED", `no fence matches: ${a.unassigned.join(", ")}`, "add the paths to a PR fence or set plan.rest, then retry");
  if (a.overlaps.length)
    return bad(
      3,
      "DIRTY_UNASSIGNED",
      `fences overlap: ${a.overlaps.map((o) => `${o.path} (PR ${o.prs.join(" and ")})`).join(", ")}`,
      "narrow the fences so each path belongs to one PR",
    );
  const empty = a.assignments.filter((x) => x.paths.length === 0);
  if (empty.length)
    return bad(3, "EMPTY_PR", `PR ${empty.map((e) => e.n).join(", ")} has no changed paths`, "drop the PR from the plan or widen its fence");
  const ahead = deps.git(["rev-list", "--count", `${plan.base}..HEAD`]);
  if (ahead.code !== 0) return gitFailure(ahead, "git rev-list");
  if (Number(ahead.stdout.trim()) > 0)
    return bad(
      3,
      "HEAD_AHEAD",
      `HEAD has ${ahead.stdout.trim()} commit(s) not on ${plan.base}; split only handles uncommitted work`,
      `start from ${plan.base} with the work uncommitted, or restack the existing commits instead`,
    );

  const staged = deps.git(["diff", "--cached", "--name-only"]);
  if (staged.code !== 0) return gitFailure(staged, "git diff --cached");
  if (staged.stdout.trim())
    return bad(
      3,
      "STAGED_FILES",
      `staged files would land in the first PR's commit: ${staged.stdout.trim().split("\n").join(", ")}`,
      "unstage them (git restore --staged .), then retry; split stages each PR's own paths",
    );

  const branches: { n: number; branch: string; sha: string; paths: string[] }[] = [];
  for (const pr of plan.prs) {
    const paths = a.assignments.find((x) => x.n === pr.n)!.paths;
    for (const [args, what] of [
      [["switch", "-c", pr.branch], `git switch -c ${pr.branch}`],
      [["add", "-A", "--", ...paths], `git add for PR ${pr.n}`],
      [["commit", "-m", pr.message], `git commit for PR ${pr.n}`],
    ] as [string[], string][]) {
      const r = deps.git(args);
      if (r.code !== 0) return gitFailure(r, what);
    }
    const sha = deps.git(["rev-parse", "HEAD"]);
    if (sha.code !== 0) return gitFailure(sha, "git rev-parse HEAD");
    branches.push({ n: pr.n, branch: pr.branch, sha: sha.stdout.trim(), paths });
  }
  return ok({ branches });
}

function restack(plan: Plan, from: string | undefined, deps: Deps): Outcome {
  const n = from === undefined ? NaN : Number(from);
  if (!Number.isInteger(n)) return usage("--from <n> is required and must be a PR number");
  const target = plan.prs.find((p) => p.n === n);
  if (!target) return usage(`--from ${n}: no such PR in the plan`);
  const last = plan.prs[plan.prs.length - 1];
  const sw = deps.git(["switch", last.branch]);
  if (sw.code !== 0) return gitFailure(sw, `git switch ${last.branch}`);
  const rb = deps.git(["rebase", "--update-refs", target.branch]);
  if (rb.code !== 0) {
    const u = deps.git(["diff", "--name-only", "--diff-filter=U"]);
    const paths = u.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
    const ab = deps.git(["rebase", "--abort"]);
    if (!paths.length) return gitFailure(rb, "git rebase");
    const e = bad(
      4,
      "CONFLICT",
      `rebase onto ${target.branch} conflicts in: ${paths.join(", ")}${ab.code !== 0 ? " (rebase --abort also failed; run it by hand)" : ""}`,
      "the rebase was aborted and nothing changed; resolve the overlap in the PR that owns those paths, then restack again",
    ) as Outcome & { err: { paths?: string[] } };
    e.err.paths = paths;
    return e;
  }
  const rebased = plan.prs.filter((p) => p.n > n).map((p) => p.branch);
  const heads: { branch: string; sha: string }[] = [];
  for (const b of [target.branch, ...rebased]) {
    const r = deps.git(["rev-parse", b]);
    if (r.code !== 0) return gitFailure(r, `git rev-parse ${b}`);
    heads.push({ branch: b, sha: r.stdout.trim() });
  }
  return ok({ rebased, heads });
}

/** Run one CLI invocation. Pure of process state: returns the exit code and what to print. */
export function run(argv: string[], deps: Deps = defaultDeps): Outcome {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) return usage(`${a} needs a value`);
      flags.set(a, v);
      i++;
    } else positional.push(a);
  }
  const verb = positional[0] ?? "";
  if (!["assign", "split", "restack"].includes(verb)) return usage(verb ? `unknown verb "${verb}"` : "a verb is required");
  const allowed = verb === "restack" ? ["--plan", "--from"] : ["--plan"];
  const unknown = [...flags.keys()].filter((f) => !allowed.includes(f));
  if (unknown.length) return usage(`unknown flag ${unknown.join(", ")} for ${verb}; accepts ${allowed.join(" ")}`);
  const plan = loadPlan(flags.get("--plan"), deps);
  if (isOutcome(plan)) return plan;
  if (verb === "assign") {
    const a = computeAssign(plan, deps);
    return isOutcome(a) ? a : ok(a);
  }
  return verb === "split" ? split(plan, deps) : restack(plan, flags.get("--from"), deps);
}

if (import.meta.main) {
  const o = run(process.argv.slice(2));
  if (o.err) console.error(JSON.stringify(o.err));
  else console.log(JSON.stringify(o.out));
  process.exit(o.code);
}
