import { describe, it, expect } from "vitest";
import { run, parseReview, normalizeConfidence, toComments, type Deps, type ProcResult } from "../greptile-local";

const HEAD = "head111";
// The shape `greptile review --json` and `greptile review show <id> --json` print (CLI 3.2).
const review = (over: Record<string, unknown> = {}) => ({
  summary: "Adds invites.\n- One P1 remains.",
  confidence: 3,
  confidenceReasoning: "Fix the auth check before merging.",
  securitySummary: null,
  instructions: null,
  comments: [
    {
      id: "35130337-0",
      path: "app/trpc/routes/invites.ts",
      startLine: 40,
      endLine: 42,
      side: "new",
      severity: "P1",
      securityIssue: true,
      category: "comment",
      body: "**Missing auth check**\n\nAny user can revoke any invite.",
      verifiedEvidence: null,
      suggestion: null,
      hunk: null,
    },
  ],
  ...over,
});
const out = (v: unknown): ProcResult => ({ code: 0, stdout: typeof v === "string" ? v : JSON.stringify(v), stderr: "" });

/** greptile replies in order (last one repeats); git answers rev-parse. */
function harness(replies: ProcResult[], git: { headFails?: boolean; baseMissing?: boolean } = {}) {
  const calls: string[][] = [];
  const timeouts: (number | undefined)[] = [];
  let i = 0;
  const deps: Deps = {
    greptile: (args, timeoutMs) => {
      calls.push(args);
      timeouts.push(timeoutMs);
      return replies[Math.min(i++, replies.length - 1)];
    },
    git: (args) => {
      if (args[0] === "rev-parse" && args[1] === "HEAD") return git.headFails ? { code: 128, stdout: "", stderr: "not a repo" } : out(`${HEAD}\n`);
      if (args.includes("--verify")) return git.baseMissing ? { code: 1, stdout: "", stderr: "" } : out("base000\n");
      return { code: 1, stdout: "", stderr: `unexpected git ${args.join(" ")}` };
    },
  };
  return { deps, calls, timeouts };
}

describe("greptile-local", () => {
  it("reviews HEAD against --base and passes --focus as --instructions", () => {
    const { deps, calls, timeouts } = harness([out(review())]);
    const o = run(["--base", "feat/x/1", "--focus", "auth on the new procedures", "--timeout", "600"], deps);
    expect(o.code).toBe(0);
    expect(calls).toEqual([["review", "-b", "feat/x/1", "--json", "--instructions", "auth on the new procedures"]]);
    expect(timeouts).toEqual([600_000]);
    const r = o.out as any;
    expect(r).toMatchObject({ status: "reviewed", base: "feat/x/1", head: HEAD, confidence: 3 });
    expect(r.summary).toContain("One P1 remains.");
    expect(r.summary).toContain("Fix the auth check");
    expect(r.comments).toEqual([
      { id: "35130337-0", path: "app/trpc/routes/invites.ts", line: 42, severity: "P1", body: "**Missing auth check**\n\nAny user can revoke any invite." },
    ]);
  });

  it("omits --instructions when there is no focus", () => {
    const { deps, calls } = harness([out(review())]);
    run(["--base", "main"], deps);
    expect(calls[0]).toEqual(["review", "-b", "main", "--json"]);
  });

  it("a clean review is reviewed with no comments", () => {
    const { deps } = harness([out(review({ comments: [], confidence: 5 }))]);
    const o = run(["--base", "main"], deps);
    expect(o.code).toBe(0);
    expect((o.out as any).comments).toEqual([]);
    expect((o.out as any).confidence).toBe(5);
  });

  it("finds the review JSON after progress lines", () => {
    const { deps } = harness([out(`Uploading diff…\nReviewing 4 files…\n${JSON.stringify(review())}\n`)]);
    expect(run(["--base", "main"], deps).code).toBe(0);
  });

  it("resumes the same review once when the first run prints no review", () => {
    const { deps, calls } = harness([{ code: 1, stdout: "", stderr: "connection reset" }, out(review())]);
    const o = run(["--base", "main"], deps);
    expect(o.code).toBe(0);
    expect(calls).toEqual([["review", "-b", "main", "--json"], ["review", "--resume", "--json"]]);
  });

  it("fails GREPTILE when the resume fails too", () => {
    const { deps, calls } = harness([{ code: 1, stdout: "", stderr: "connection reset" }]);
    const o = run(["--base", "main"], deps);
    expect(o.code).toBe(2);
    expect(o.err?.code).toBe("GREPTILE");
    expect(calls).toHaveLength(2);
  });

  it("signed out: no retry, and the help says to log in", () => {
    const { deps, calls } = harness([{ code: 1, stdout: "", stderr: "You are not signed in. Run `greptile login`." }]);
    const o = run(["--base", "main"], deps);
    expect(o.code).toBe(2);
    expect(o.err?.help).toBe("run: greptile login");
    expect(calls).toHaveLength(1);
  });

  it("missing CLI: no retry, and the help says to install it", () => {
    const { deps, calls } = harness([{ code: 127, stdout: "", stderr: "cannot run greptile: ENOENT" }]);
    const o = run(["--base", "main"], deps);
    expect(o.code).toBe(2);
    expect(o.err?.help).toMatch(/install the Greptile CLI/);
    expect(calls).toHaveLength(1);
  });

  it("times out with exit 5 and a status JSON on stdout", () => {
    const timedOut: ProcResult = { code: 124, stdout: "", stderr: "", timedOut: true };
    const { deps } = harness([timedOut]);
    const o = run(["--base", "main", "--timeout", "1"], deps);
    expect(o.code).toBe(5);
    expect(o.out).toMatchObject({ status: "timeout", comments: [] });
    expect(o.err?.code).toBe("TIMEOUT");
  });

  it("a base that is not a commit fails GIT before calling greptile", () => {
    const { deps, calls } = harness([out(review())], { baseMissing: true });
    const o = run(["--base", "nope"], deps);
    expect(o.code).toBe(3);
    expect(o.err?.code).toBe("GIT");
    expect(calls).toHaveLength(0);
  });

  it("outside a repository fails GIT", () => {
    const { deps } = harness([out(review())], { headFails: true });
    expect(run(["--base", "main"], deps).code).toBe(3);
  });

  it.each([
    [[], "--base is required"],
    [["--base"], "--base needs a value"],
    [["--base", "main", "--timeout", "0"], "--timeout must be a positive number"],
    [["--base", "main", "--bogus", "1"], "unknown flag --bogus"],
    [["main"], 'unexpected argument "main"'],
  ])("usage error for %j", (argv, msg) => {
    const { deps } = harness([out(review())]);
    const o = run(argv as string[], deps);
    expect(o.code).toBe(1);
    expect(o.err?.error).toContain(msg);
  });
});

describe("parseReview", () => {
  it("returns null for empty, non-JSON and JSON without comments", () => {
    expect(parseReview("")).toBeNull();
    expect(parseReview("no review")).toBeNull();
    expect(parseReview('{"status":"IN_FLIGHT"}')).toBeNull();
    expect(parseReview("[]")).toBeNull();
  });
  it("takes the last review line when several JSON lines print", () => {
    const a = JSON.stringify(review({ summary: "first" }));
    const b = JSON.stringify(review({ summary: "second" }));
    expect(parseReview(`${a}\n${b}`)?.summary).toBe("second");
  });
});

describe("normalizeConfidence", () => {
  it("keeps 1-5 and maps 0, null and junk to null", () => {
    expect(normalizeConfidence(1)).toBe(1);
    expect(normalizeConfidence(5)).toBe(5);
    expect(normalizeConfidence(0)).toBeNull();
    expect(normalizeConfidence(null)).toBeNull();
    expect(normalizeConfidence("4")).toBeNull();
  });
});

describe("toComments", () => {
  it("falls back to startLine, then null, and drops comments with no body", () => {
    const c = toComments({
      comments: [
        { id: 1, path: "a.ts", startLine: 3, body: "x" },
        { id: "2", path: "b.ts", body: "y" },
        { id: "3", path: "c.ts" },
      ],
    });
    expect(c).toEqual([
      { id: "1", path: "a.ts", line: 3, severity: "", body: "x" },
      { id: "2", path: "b.ts", line: null, severity: "", body: "y" },
    ]);
  });
});
