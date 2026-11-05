/**
 * Runs a Greptile review of the checked-out branch from the CLI, before anything is pushed.
 *
 *   bun run scripts/greptile-local.ts --base <branch|sha> [--focus "<text>"] [--timeout 900]
 *
 * Calls `greptile review -b <base> --json [--instructions <focus>]`, the same reviewer the PR bot runs,
 * on the diff of HEAD against <base>. If that run dies or prints no review (a dropped connection, a
 * timeout) it runs `greptile review --resume --json` once to pick up the same review. --timeout is the
 * budget for both runs together, so a caller's own limit just above it is never hit first.
 *
 * Success prints one JSON object to stdout: { status: "reviewed", base, head, confidence, summary, comments }
 * with comments [{ id, path, line, severity, body }], the shape the ship-feature workflow hands to
 * review-responder. Failure prints { error, code, help } to stderr.
 * Exit codes: 0 reviewed, 1 USAGE, 2 GREPTILE (CLI missing, signed out, or the review failed), 3 GIT,
 * 5 TIMEOUT (the status JSON still goes to stdout, the error to stderr).
 *
 * `greptile`, `git` and the clock are injected (`Deps`), so the tests run with no network and no repository.
 */
import { spawnSync } from "node:child_process";

export interface ProcResult {
  code: number;
  stdout: string;
  stderr: string;
  /** True when the process was killed for running past its timeout. */
  timedOut?: boolean;
}
/** Runs `<cli> <args>` and reports what happened. Never throws. */
export type Runner = (args: string[], timeoutMs?: number) => ProcResult;

export interface Deps {
  greptile: Runner;
  git: Runner;
  /** Milliseconds; any monotonic origin. */
  now: () => number;
}

export interface Outcome {
  code: number;
  out?: unknown;
  err?: { error: string; code: string; help: string };
}

export interface LocalComment {
  id: string;
  path: string;
  line: number | null;
  severity: string;
  body: string;
}

const ok = (out: unknown, code = 0): Outcome => ({ code, out });
const bad = (code: number, kind: string, error: string, help: string): Outcome => ({
  code,
  err: { error, code: kind, help },
});
const usage = (error: string): Outcome =>
  bad(1, "USAGE", error, 'usage: greptile-local --base <branch|sha> [--focus "<text>"] [--timeout 900]');

const spawner =
  (cli: string): Runner =>
  (args, timeoutMs) => {
    const r = spawnSync(cli, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs });
    if (r.error && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT")
      return { code: 124, stdout: r.stdout ?? "", stderr: r.stderr ?? "", timedOut: true };
    if (r.error) return { code: 127, stdout: "", stderr: `cannot run ${cli}: ${r.error.message}` };
    return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };

export const defaultDeps: Deps = { greptile: spawner("greptile"), git: spawner("git"), now: () => Date.now() };

/** The review object from `greptile review --json`: the whole stdout, or else its last JSON line. */
export function parseReview(text: string): any | null {
  const isReview = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v) && Array.isArray((v as any).comments);
  const t = text.trim();
  if (!t) return null;
  try {
    const v = JSON.parse(t);
    return isReview(v) ? v : null;
  } catch {
    // progress lines around the JSON: fall through
  }
  for (const line of t.split("\n").reverse()) {
    const l = line.trim();
    if (!l.startsWith("{")) continue;
    try {
      const v = JSON.parse(l);
      if (isReview(v)) return v;
    } catch {
      // not JSON
    }
  }
  return null;
}

/** Greptile scores 1-5; the CLI prints 0 or null when it has no score. */
export function normalizeConfidence(v: unknown): number | null {
  return typeof v === "number" && v >= 1 && v <= 5 ? v : null;
}

export function toComments(review: any): LocalComment[] {
  return (review?.comments ?? [])
    .filter((c: any) => c && typeof c.body === "string")
    .map((c: any) => ({
      id: String(c.id ?? ""),
      path: String(c.path ?? ""),
      line: typeof c.endLine === "number" ? c.endLine : typeof c.startLine === "number" ? c.startLine : null,
      severity: String(c.severity ?? ""),
      body: c.body,
    }));
}

const SIGNED_OUT = /not (signed|logged) in|greptile login|unauthori[sz]ed/i;

function greptileFailure(r: ProcResult, what: string): Outcome {
  const text = r.stderr.trim() || r.stdout.trim() || `greptile exited ${r.code}`;
  const help =
    r.code === 127
      ? "install the Greptile CLI (https://greptile.com), then run: greptile login"
      : SIGNED_OUT.test(text)
        ? "run: greptile login"
        : "run the same greptile command by hand to see why";
  return bad(2, "GREPTILE", `${what}: ${text}`, help);
}

export function run(argv: string[], deps: Deps = defaultDeps): Outcome {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) return usage(`unexpected argument "${a}"`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) return usage(`${a} needs a value`);
    flags.set(a, v);
    i++;
  }
  const unknown = [...flags.keys()].filter((f) => !["--base", "--focus", "--timeout"].includes(f));
  if (unknown.length) return usage(`unknown flag ${unknown.join(", ")}`);
  const base = flags.get("--base");
  if (!base) return usage("--base is required");
  const rawTimeout = flags.get("--timeout") ?? "900";
  const timeout = Number(rawTimeout);
  if (!Number.isFinite(timeout) || timeout <= 0) return usage(`--timeout must be a positive number, got "${rawTimeout}"`);
  const focus = flags.get("--focus");

  const h = deps.git(["rev-parse", "HEAD"]);
  const head = h.stdout.trim();
  if (h.code !== 0 || !head) return bad(3, "GIT", `git rev-parse HEAD: ${h.stderr.trim() || "no HEAD"}`, "run inside the repository, on the branch to review");
  const b = deps.git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
  if (b.code !== 0) return bad(3, "GIT", `base "${base}" is not a commit here`, "pass a local branch or a sha that exists in this checkout");

  const args = ["review", "-b", base, "--json", ...(focus ? ["--instructions", focus] : [])];
  const deadline = deps.now() + timeout * 1000;
  let r = deps.greptile(args, timeout * 1000);
  let review = r.code === 0 ? parseReview(r.stdout) : null;
  const left = deadline - deps.now();
  if (!review && !SIGNED_OUT.test(r.stderr + r.stdout) && r.code !== 127 && left >= 1000) {
    // One retry that attaches to the same review instead of starting a second one, inside what is left.
    r = deps.greptile(["review", "--resume", "--json"], left);
    review = r.code === 0 ? parseReview(r.stdout) : null;
  }
  if (!review) {
    if (r.timedOut) {
      return {
        ...ok({ status: "timeout", base, head, confidence: null, summary: "", comments: [] }, 5),
        err: { error: `no review within ${timeout}s`, code: "TIMEOUT", help: "run again with a longer --timeout, or `greptile review --resume`" },
      };
    }
    return greptileFailure(r, "greptile review");
  }

  return ok({
    status: "reviewed",
    base,
    head,
    confidence: normalizeConfidence(review.confidence),
    summary: [review.summary, review.confidenceReasoning].filter((s) => typeof s === "string" && s.trim()).join("\n\n"),
    comments: toComments(review),
  });
}

if (import.meta.main) {
  const o = run(process.argv.slice(2));
  if (o.err) console.error(JSON.stringify(o.err));
  if (o.out !== undefined) console.log(JSON.stringify(o.out));
  process.exit(o.code);
}
