/**
 * Waits for a Greptile review on a PR's head commit and reads it back.
 *
 *   bun run scripts/pr-review-wait.ts <pr> [--timeout 900] [--interval 30] [--retrigger-after 300]
 *
 * Polls the PR's reviews until one from a login starting with `greptile-apps` has commit_id equal to the
 * PR's current head. After --retrigger-after seconds with no review it posts
 * `@greptileai review` once. Then it reads that review's inline comments and the bot's summary
 * issue comment (marker `<!-- greptile_summary -->`, the last one wins) and parses `Confidence Score: N/5`.
 *
 * Success prints one JSON object to stdout. Failure prints { error, code, help } to stderr.
 * Exit codes: 0 reviewed, 1 USAGE, 2 GH, 5 TIMEOUT (the status JSON still goes to stdout, the error to stderr).
 *
 * `gh`, `sleep` and the clock are injected (`Deps`), so the tests run with no network and no waiting.
 * Lists use `gh api --paginate`; the parser takes a JSON array, concatenated arrays or one object per line.
 */
import { spawnSync } from "node:child_process";

export interface GhResult {
  code: number;
  stdout: string;
  stderr: string;
}
/** Runs `gh <args>` and reports what happened. Never throws. */
export type GhRunner = (args: string[]) => GhResult;

export interface Deps {
  gh: GhRunner;
  sleep: (ms: number) => Promise<void>;
  /** Milliseconds; any monotonic origin. */
  now: () => number;
}

export interface Outcome {
  code: number;
  out?: unknown;
  err?: { error: string; code: string; help: string };
}

const ok = (out: unknown, code = 0): Outcome => ({ code, out });
const bad = (code: number, kind: string, error: string, help: string): Outcome => ({
  code,
  err: { error, code: kind, help },
});
const usage = (error: string): Outcome =>
  bad(1, "USAGE", error, "usage: pr-review-wait <pr> [--timeout 900] [--interval 30] [--retrigger-after 300]");
const ghFailure = (r: GhResult, what: string): Outcome =>
  bad(
    2,
    "GH",
    `${what}: ${r.stderr.trim() || r.stdout.trim() || `gh exited ${r.code}`}`,
    r.code === 127 ? "install the GitHub CLI and run: gh auth login" : "run the same gh command by hand to see why",
  );

export const defaultDeps: Deps = {
  gh: (args) => {
    const r = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.error) return { code: 127, stdout: "", stderr: `cannot run gh: ${r.error.message}` };
    return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  },
  sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
  now: () => Date.now(),
};

/** Items from `gh api --paginate`: one array, several arrays back to back, or one object per line. */
export function parseItems(text: string): any[] {
  const t = text.trim();
  if (!t) return [];
  try {
    const v = JSON.parse(t);
    return Array.isArray(v) ? v : [v];
  } catch {
    // fall through
  }
  const items: any[] = [];
  for (const line of t.split("\n")) {
    const l = line.trim().replace(/^\]\[/, "");
    if (!l) continue;
    try {
      const v = JSON.parse(l);
      if (Array.isArray(v)) items.push(...v);
      else items.push(v);
    } catch {
      // ignore a line that is not JSON
    }
  }
  return items;
}

export function parseConfidence(summary: string): number | null {
  const m = /Confidence Score:\s*(\d)\s*\/\s*5/.exec(summary);
  return m ? Number(m[1]) : null;
}

const BOT = "greptile-apps";
const MARKER = "<!-- greptile_summary -->";

function num(flags: Map<string, string>, name: string, dflt: number): number | Outcome {
  const raw = flags.get(name);
  if (raw === undefined) return dflt;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : usage(`${name} must be a non-negative number, got "${raw}"`);
}
const isOutcome = (v: unknown): v is Outcome => typeof v === "object" && v !== null && "code" in v;

export async function run(argv: string[], deps: Deps = defaultDeps): Promise<Outcome> {
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
  const unknown = [...flags.keys()].filter((f) => !["--timeout", "--interval", "--retrigger-after"].includes(f));
  if (unknown.length) return usage(`unknown flag ${unknown.join(", ")}`);
  const prRaw = positional[0]?.replace(/^#/, "");
  if (!prRaw || !/^\d+$/.test(prRaw)) return usage(`<pr> must be a number, got "${positional[0] ?? ""}"`);
  const pr = Number(prRaw);
  const timeout = num(flags, "--timeout", 900);
  if (isOutcome(timeout)) return timeout;
  const interval = num(flags, "--interval", 30);
  if (isOutcome(interval)) return interval;
  const retriggerAfter = num(flags, "--retrigger-after", 300);
  if (isOutcome(retriggerAfter)) return retriggerAfter;

  const repoR = deps.gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
  const repo = repoR.stdout.trim();
  if (repoR.code !== 0 || !repo) return ghFailure(repoR.code !== 0 ? repoR : { ...repoR, stderr: "could not resolve the repository" }, "gh repo view");

  const h = deps.gh(["pr", "view", String(pr), "--json", "headRefOid", "-q", ".headRefOid"]);
  const sha = h.stdout.trim();
  if (h.code !== 0 || !sha) return ghFailure(h.code !== 0 ? h : { ...h, stderr: "no head sha" }, `gh pr view ${pr}`);

  const isBot = (login: unknown) => typeof login === "string" && login.toLowerCase().startsWith(BOT);
  const start = deps.now();
  let retriggered = false;
  let review: any = null;

  for (;;) {
    const r = deps.gh(["api", "--paginate", `repos/${repo}/pulls/${pr}/reviews`]);
    if (r.code !== 0) return ghFailure(r, "gh api reviews");
    const hits = parseItems(r.stdout).filter((x) => isBot(x?.user?.login) && x?.commit_id === sha);
    // Latest submission wins; a re-review of the same commit supersedes the first.
    review = hits.sort((a, b) => String(a.submitted_at ?? "").localeCompare(String(b.submitted_at ?? ""))).pop() ?? null;
    if (review) break;
    const elapsed = (deps.now() - start) / 1000;
    if (elapsed >= timeout) break;
    if (!retriggered && elapsed >= retriggerAfter) {
      const c = deps.gh(["pr", "comment", String(pr), "--body", "@greptileai review"]);
      if (c.code !== 0) return ghFailure(c, "gh pr comment");
      retriggered = true;
    }
    await deps.sleep(interval * 1000);
  }

  if (!review) {
    return {
      ...ok({ status: "timeout", pr, sha, review: null, confidence: null, summary: "", comments: [], retriggered }, 5),
      err: { error: `no ${BOT} review of ${sha} within ${timeout}s`, code: "TIMEOUT", help: "check the PR on GitHub, or run again with a longer --timeout" },
    };
  }

  const cr = deps.gh(["api", "--paginate", `repos/${repo}/pulls/${pr}/comments`]);
  if (cr.code !== 0) return ghFailure(cr, "gh api pull comments");
  const comments = parseItems(cr.stdout)
    .filter((c) => c?.pull_request_review_id === review.id)
    .map((c) => ({ id: c.id, path: c.path, line: c.line ?? c.original_line ?? null, body: c.body, url: c.html_url }));

  const ir = deps.gh(["api", "--paginate", `repos/${repo}/issues/${pr}/comments`]);
  if (ir.code !== 0) return ghFailure(ir, "gh api issue comments");
  const summary = parseItems(ir.stdout)
    .filter((c) => isBot(c?.user?.login) && typeof c?.body === "string" && c.body.includes(MARKER) && c.body.includes(sha))
    .pop()?.body ?? "";

  return ok({
    status: "reviewed",
    pr,
    sha,
    review: { id: review.id, state: review.state, submitted_at: review.submitted_at, body: review.body ?? "" },
    confidence: parseConfidence(summary),
    summary,
    comments,
    retriggered,
  });
}

if (import.meta.main) {
  const o = await run(process.argv.slice(2));
  if (o.err) console.error(JSON.stringify(o.err));
  if (o.out !== undefined) console.log(JSON.stringify(o.out));
  process.exit(o.code);
}
