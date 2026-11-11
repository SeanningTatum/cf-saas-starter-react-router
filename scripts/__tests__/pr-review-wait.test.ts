import { describe, it, expect } from "vitest";
import { run, parseConfidence, parseItems, type Deps, type GhResult } from "../pr-review-wait";

const SHA = "new111";
const review = (over: Record<string, unknown> = {}) => ({
  id: 7,
  user: { login: "greptile-apps[bot]" },
  commit_id: SHA,
  state: "COMMENTED",
  submitted_at: "2026-10-25T10:00:00Z",
  body: "reviewed",
  ...over,
});
const summaryBody = (n: number, sha = SHA) =>
  `<!-- greptile_summary -->\nGreptile summary\n**Confidence Score: ${n}/5**\nLast reviewed commit: https://github.com/a/b/commit/${sha}`;
const bot = { login: "greptile-apps[bot]" };

interface World {
  /** reviews returned on each poll, by poll index (last one repeats) */
  reviews: unknown[][];
  comments?: unknown[];
  issueComments?: unknown[];
  /** check runs on the head returned on each poll, by poll index (last one repeats); default none */
  checkRuns?: unknown[][];
}

/** A gh stub plus a fake clock: `sleep` advances time, so no test waits. */
function harness(w: World, flags: { commentFails?: boolean } = {}) {
  const calls: string[][] = [];
  let t = 1_000_000;
  let poll = 0;
  let checkPoll = 0;
  const sleeps: number[] = [];
  const deps: Deps = {
    gh: (args): GhResult => {
      calls.push(args);
      const j = args.join(" ");
      const out = (v: unknown): GhResult => ({ code: 0, stdout: typeof v === "string" ? v : JSON.stringify(v), stderr: "" });
      if (j.startsWith("repo view")) return out("acme/saas\n");
      if (j.startsWith("pr view")) return out(`${SHA}\n`);
      if (j.startsWith("pr comment")) return flags.commentFails ? { code: 1, stdout: "", stderr: "boom" } : out("");
      if (j.includes(`/commits/${SHA}/check-runs`)) {
        // `--paginate --jq .check_runs[]` prints one run per line across every page.
        const runs = w.checkRuns ?? [[]];
        return out(runs[Math.min(checkPoll++, runs.length - 1)].map((x) => JSON.stringify(x)).join("\n"));
      }
      if (j.endsWith("/reviews")) return out(w.reviews[Math.min(poll++, w.reviews.length - 1)]);
      if (j.endsWith("/pulls/5/comments")) return out(w.comments ?? []);
      if (j.endsWith("/issues/5/comments")) return out(w.issueComments ?? []);
      return { code: 1, stdout: "", stderr: `unexpected ${j}` };
    },
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    now: () => t,
  };
  return { deps, calls, sleeps };
}
const retriggers = (calls: string[][]) => calls.filter((c) => c[0] === "pr" && c[1] === "comment");

describe("pr-review-wait", () => {
  it("matches on the head sha: a bot review of an older commit is ignored and the wait continues", async () => {
    const { deps } = harness({ reviews: [[review({ id: 1, commit_id: "old000" })], [review({ id: 1, commit_id: "old000" }), review({ id: 2 })]] });
    const o = await run(["5"], deps);
    expect(o.code).toBe(0);
    expect((o.out as any).status).toBe("reviewed");
    expect((o.out as any).review.id).toBe(2);
  });

  it("matches the bot by login prefix and ignores human reviews of the same commit", async () => {
    const { deps } = harness({ reviews: [[review({ id: 1, user: { login: "sean" } })], [review({ id: 1, user: { login: "sean" } }), review({ id: 9 })]] });
    const o = await run(["5"], deps);
    expect((o.out as any).review.id).toBe(9);
  });

  it("reads the PR's current head sha and reports it", async () => {
    const a = harness({ reviews: [[review()]] });
    const o = await run(["5"], a.deps);
    expect(a.calls.some((c) => c[0] === "pr" && c[1] === "view")).toBe(true);
    expect((o.out as any).sha).toBe(SHA);
  });

  it("retriggers exactly once however many polls follow, with the Greptile trigger text", async () => {
    const { deps, calls } = harness({ reviews: [[], [], [], [], [], [review()]] });
    const o = await run(["5", "--retrigger-after", "60", "--interval", "30", "--timeout", "900"], deps);
    expect(o.code).toBe(0);
    expect(retriggers(calls)).toEqual([["pr", "comment", "5", "--body", "@greptileai review"]]);
  });

  it("does not retrigger when the review arrives before --retrigger-after", async () => {
    const { deps, calls } = harness({ reviews: [[], [review()]] });
    await run(["5", "--retrigger-after", "300", "--interval", "30"], deps);
    expect(retriggers(calls)).toHaveLength(0);
  });

  it("times out with exit 5 TIMEOUT, review null, after sleeping interval seconds between polls", async () => {
    const { deps, sleeps } = harness({ reviews: [[]] });
    const o = await run(["5", "--timeout", "100", "--interval", "30", "--retrigger-after", "40"], deps);
    expect(o.code).toBe(5);
    expect(o.err?.code).toBe("TIMEOUT");
    expect(o.out).toMatchObject({ status: "timeout", review: null, confidence: null, comments: [], retriggered: true });
    expect(sleeps.every((s) => s === 30_000)).toBe(true);
    expect(sleeps).toHaveLength(4);
  });

  it("keeps only inline comments whose pull_request_review_id is the matched review, mapped to the contract shape", async () => {
    const { deps } = harness({
      reviews: [[review({ id: 7 })]],
      comments: [
        { id: 1, pull_request_review_id: 7, path: "a.ts", line: 12, body: "mine", html_url: "u1" },
        { id: 2, pull_request_review_id: 3, path: "b.ts", line: 4, body: "older review", html_url: "u2" },
        { id: 3, pull_request_review_id: 7, path: "c.ts", line: null, original_line: 9, body: "outdated", html_url: "u3" },
      ],
    });
    const o = await run(["5"], deps);
    expect((o.out as any).comments).toEqual([
      { id: 1, path: "a.ts", line: 12, body: "mine", url: "u1" },
      { id: 3, path: "c.ts", line: 9, body: "outdated", url: "u3" },
    ]);
  });

  it("reads confidence from the LAST summary comment: a retrigger posts a newer summary", async () => {
    const { deps } = harness({
      reviews: [[review()]],
      issueComments: [{ user: bot, body: summaryBody(2) }, { user: bot, body: "unrelated 5/5" }, { user: bot, body: summaryBody(4) }],
    });
    const o = await run(["5"], deps);
    expect((o.out as any).confidence).toBe(4);
    expect((o.out as any).summary).toContain("Confidence Score: 4/5");
  });

  it("confidence is null, not 0, when no summary comment exists", async () => {
    const { deps } = harness({ reviews: [[review()]], issueComments: [{ body: "Confidence Score: 3/5 but no marker" }] });
    const o = await run(["5"], deps);
    expect((o.out as any).confidence).toBeNull();
    expect((o.out as any).summary).toBe("");
  });

  it("ignores a marker comment from a human or tied to another commit: no score beats a wrong one", async () => {
    const { deps } = harness({
      reviews: [[review()]],
      issueComments: [{ user: { login: "someone" }, body: summaryBody(1) }, { user: bot, body: summaryBody(2, "old999") }],
    });
    const o = await run(["5"], deps);
    expect((o.out as any).confidence).toBeNull();
    expect((o.out as any).summary).toBe("");
  });

  describe("a clean review: no inline comments, so Greptile submits no PR review", () => {
    const check = (status: string) => ({ name: "Greptile Review", status, conclusion: status === "completed" ? "success" : null, app: { slug: "greptile-apps" } });

    it("a completed Greptile check plus a summary naming the head is reviewed, with no review and no comments", async () => {
      const { deps, calls } = harness({ reviews: [[]], checkRuns: [[check("in_progress")], [check("completed")]], issueComments: [{ user: bot, body: summaryBody(5) }] });
      const o = await run(["5"], deps);
      expect(o.code).toBe(0);
      expect(o.out).toMatchObject({ status: "reviewed", review: null, confidence: 5, comments: [], retriggered: false });
      expect(calls.some((c) => c.join(" ").endsWith("/pulls/5/comments"))).toBe(false);
    });

    it("keeps polling until the summary names the head: it lands a moment after the check completes", async () => {
      let n = 0;
      const h = harness({ reviews: [[]], checkRuns: [[check("completed")]] });
      const gh = h.deps.gh;
      h.deps.gh = (args) => {
        if (args.join(" ").endsWith("/issues/5/comments")) {
          n++;
          return { code: 0, stdout: JSON.stringify(n < 3 ? [{ user: bot, body: summaryBody(3, "old999") }] : [{ user: bot, body: summaryBody(4) }]), stderr: "" };
        }
        return gh(args);
      };
      const o = await run(["5"], h.deps);
      expect(o.code).toBe(0);
      expect((o.out as any).confidence).toBe(4);
      expect(n).toBe(3);
    });

    it("a review with comments still wins when the check is also complete: reviews are read after the check", async () => {
      const { deps } = harness({
        reviews: [[review({ id: 7 })]],
        checkRuns: [[check("completed")]],
        comments: [{ id: 1, pull_request_review_id: 7, path: "a.ts", line: 3, body: "bug", html_url: "u1" }],
        issueComments: [{ user: bot, body: summaryBody(3) }],
      });
      const o = await run(["5"], deps);
      expect((o.out as any).review.id).toBe(7);
      expect((o.out as any).comments).toHaveLength(1);
    });

    it("no retrigger while a Greptile check is queued or running on the head", async () => {
      const { deps, calls } = harness({ reviews: [[]], checkRuns: [[check("queued")], [check("in_progress")]] });
      const o = await run(["5", "--retrigger-after", "0", "--interval", "30", "--timeout", "120"], deps);
      expect(o.code).toBe(5);
      expect(retriggers(calls)).toHaveLength(0);
    });

    it("a failed or cancelled check with no summary still retriggers once, then keeps waiting", async () => {
      const failed = { ...check("completed"), conclusion: "failure" };
      const { deps, calls } = harness({ reviews: [[]], checkRuns: [[failed]] });
      const o = await run(["5", "--retrigger-after", "0", "--interval", "30", "--timeout", "120"], deps);
      expect(o.code).toBe(5);
      expect(retriggers(calls)).toHaveLength(1);
    });

    it("reads the Greptile check from any page: other apps' runs come first", async () => {
      const others = Array.from({ length: 150 }, (_, i) => ({ name: `ci-${i}`, status: "completed", app: { slug: "github-actions" } }));
      const { deps, calls } = harness({ reviews: [[]], checkRuns: [[...others, check("completed")]], issueComments: [{ user: bot, body: summaryBody(5) }] });
      const o = await run(["5"], deps);
      expect(o.code).toBe(0);
      expect((o.out as any).confidence).toBe(5);
      expect(calls.find((c) => c.join(" ").includes("check-runs"))).toEqual(expect.arrayContaining(["--paginate", "--jq", ".check_runs[]"]));
    });

    it("ignores check runs from other apps", async () => {
      const other = { ...check("completed"), app: { slug: "github-actions" } };
      const { deps, calls } = harness({ reviews: [[]], checkRuns: [[other]], issueComments: [{ user: bot, body: summaryBody(5) }] });
      const o = await run(["5", "--retrigger-after", "0", "--timeout", "60"], deps);
      expect(o.code).toBe(5);
      expect(retriggers(calls)).toHaveLength(1);
    });
  });

  it("a gh failure exits 2 GH instead of polling forever", async () => {
    const h = harness({ reviews: [[]] });
    const gh = h.deps.gh;
    h.deps.gh = (args) => (args.join(" ").endsWith("/reviews") ? { code: 1, stdout: "", stderr: "HTTP 502" } : gh(args));
    const o = await run(["5"], h.deps);
    expect(o.code).toBe(2);
    expect(o.err?.code).toBe("GH");
  });

  it("a failed retrigger comment exits 2 and does not claim a retrigger", async () => {
    const { deps } = harness({ reviews: [[]] }, { commentFails: true });
    const o = await run(["5", "--retrigger-after", "0"], deps);
    expect(o.code).toBe(2);
  });

  it("rejects a non-numeric <pr> with USAGE", async () => {
    const { deps } = harness({ reviews: [[]] });
    expect((await run(["abc"], deps)).code).toBe(1);
  });
});

describe("parsers", () => {
  it("parseConfidence reads 'Confidence Score: N/5' with spacing variants and returns null otherwise", () => {
    expect(parseConfidence("**Confidence Score: 5/5**")).toBe(5);
    expect(parseConfidence("Confidence Score:  3 / 5")).toBe(3);
    expect(parseConfidence("no score")).toBeNull();
  });

  it("parseItems handles one array, back-to-back arrays and one object per line: --paginate prints any of these", () => {
    expect(parseItems('[{"a":1}]')).toEqual([{ a: 1 }]);
    expect(parseItems('[{"a":1}]\n[{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }]);
    expect(parseItems('{"a":1}\n{"a":2}')).toEqual([{ a: 1 }, { a: 2 }]);
    expect(parseItems("")).toEqual([]);
  });
});
