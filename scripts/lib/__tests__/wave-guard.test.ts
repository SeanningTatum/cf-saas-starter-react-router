import { Either } from "effect";
import { describe, expect, it } from "vitest";
import type { GhResult, GhRunner } from "../gh";
import { type Check, guardDecision, mergePr, type PrView, readGuard, sortChecks, type Thread, unansweredThreads } from "../wave-guard";
import { SHA_A, WAVE } from "./helpers/wave-fixture";

const run = (name: string, conclusion: string | null, status = "COMPLETED"): Check => ({ name, status, conclusion });
const ctx = (context: string, state: string): Check => ({ context, state });
const thread = (authors: (string | null)[], isResolved = false): Thread => ({
  isResolved,
  comments: { nodes: authors.map((login, i) => ({ author: login === null ? null : { login }, url: `https://x/c${i}` })) },
});
const view = (over: Partial<PrView> = {}): PrView => ({
  state: "OPEN",
  baseRefName: WAVE,
  headRefOid: SHA_A,
  mergeable: "MERGEABLE",
  statusCheckRollup: [run("unit", "SUCCESS")],
  ...over,
});

describe("sortChecks", () => {
  it("sorts check runs and status contexts into red and pending; success and skipped pass", () => {
    const checks = [
      run("unit", "SUCCESS"),
      run("e2e", "SKIPPED"),
      run("lint", "FAILURE"),
      run("build", null, "IN_PROGRESS"),
      ctx("greptile", "SUCCESS"),
      ctx("deploy", "ERROR"),
      ctx("size", "PENDING"),
      { conclusion: "FAILURE", status: "COMPLETED" },
    ];
    expect(sortChecks(checks)).toEqual({ red: ["lint", "deploy", "unnamed check"], pending: ["build", "size"] });
  });

  it("a NEUTRAL check run is red: the merge bar is success or skipped only, so a check that took no stand never waves a PR through", () => {
    expect(sortChecks([run("advice", "NEUTRAL")]).red).toEqual(["advice"]);
  });
});

describe("unansweredThreads", () => {
  it("a thread is unanswered when nobody but the reviewer wrote after the reviewer's last comment", () => {
    expect(unansweredThreads([thread(["bot"])])).toEqual(["https://x/c0"]);
    expect(unansweredThreads([thread(["bot", "bot"])])).toEqual(["https://x/c1"]);
    expect(unansweredThreads([thread(["bot", "agent"])])).toEqual([]);
    expect(unansweredThreads([thread(["bot", "agent", "bot"])])).toEqual(["https://x/c2"]);
  });

  it("a resolved or empty thread needs no answer", () => {
    expect(unansweredThreads([thread(["bot"], true), thread([])])).toEqual([]);
  });

  it("a thread without urls is still listed, by its reviewer", () => {
    expect(unansweredThreads([{ isResolved: false, comments: { nodes: [{ author: { login: "bot" } }] } }])).toEqual(["thread by bot"]);
  });
});

describe("guardDecision", () => {
  it("green needs every check passed and every thread answered", () => {
    expect(guardDecision(view(), [thread(["bot", "agent"])], WAVE)).toMatchObject({ verdict: "green", head: SHA_A, mergeable: "MERGEABLE" });
  });

  it("an unanswered review thread is not green even with green checks", () => {
    expect(guardDecision(view(), [thread(["bot"])], WAVE)).toMatchObject({ verdict: "threads", unanswered: ["https://x/c0"] });
  });

  it("a red check is not green, and red outranks pending and threads so the fix starts at once", () => {
    const g = guardDecision(view({ statusCheckRollup: [run("lint", "FAILURE"), run("e2e", null, "QUEUED")] }), [thread(["bot"])], WAVE);
    expect(g).toMatchObject({ verdict: "red", line: "red checks: lint", pending: ["e2e"] });
  });

  it("a pending, empty or missing check list is pending, never green", () => {
    expect(guardDecision(view({ statusCheckRollup: [run("e2e", null, "IN_PROGRESS")] }), [], WAVE).verdict).toBe("pending");
    expect(guardDecision(view({ statusCheckRollup: [] }), [], WAVE).verdict).toBe("pending");
    expect(guardDecision(view({ statusCheckRollup: null }), [], WAVE).verdict).toBe("pending");
  });

  it("a PR whose base is not the wave branch is closed, so the run cannot merge it into the roll-up base", () => {
    expect(guardDecision(view({ baseRefName: "main" }), [], WAVE)).toMatchObject({
      verdict: "closed",
      line: `the PR's base is main, not the wave branch ${WAVE}`,
    });
  });

  it("a PR whose head is not the ticket's own branch, or comes from a fork, is closed: a mistaken PR number never merges someone else's PR", () => {
    const own = { headRefName: "w/11", isCrossRepository: false };
    expect(guardDecision(view(own), [], WAVE, "w/11").verdict).toBe("green");
    expect(guardDecision(view({ ...own, headRefName: "w/12" }), [], WAVE, "w/11").verdict).toBe("closed");
    expect(guardDecision(view({ ...own, isCrossRepository: true }), [], WAVE, "w/11").verdict).toBe("closed");
    expect(guardDecision(view(), [], WAVE, "w/11").verdict).toBe("closed");
  });

  it("a closed PR is closed and a merged PR is merged, whatever its checks say", () => {
    expect(guardDecision(view({ state: "CLOSED" }), [], WAVE)).toMatchObject({ verdict: "closed", line: "the PR is closed" });
    expect(guardDecision(view({ state: "MERGED", baseRefName: "main" }), [], WAVE).verdict).toBe("merged");
  });
});

const ok = (stdout: unknown): GhResult => ({ code: 0, stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout), stderr: "" });
const threadsReply = (nodes: Thread[]) => ({ data: { repository: { pullRequest: { reviewThreads: { nodes } } } } });

function fakeGh(answers: { repo?: GhResult; view?: GhResult; threads?: GhResult; merge?: GhResult }) {
  const calls: string[][] = [];
  const gh: GhRunner = (args) => {
    calls.push(args);
    if (args[0] === "repo") return answers.repo ?? ok("acme/saas\n");
    if (args[1] === "view") return answers.view ?? ok(view());
    if (args[0] === "api") return answers.threads ?? ok(threadsReply([]));
    if (args[1] === "merge") return answers.merge ?? ok("");
    return { code: 1, stdout: "", stderr: `unexpected gh ${args.join(" ")}` };
  };
  return { gh, calls };
}

describe("readGuard", () => {
  it("reads the PR and its threads for the right repo and PR number and decides on them", () => {
    const { gh, calls } = fakeGh({ threads: ok(threadsReply([thread(["bot"])])) });
    expect(readGuard(gh, 101, WAVE)).toEqual(Either.right(expect.objectContaining({ verdict: "threads" })));
    expect(calls[1]).toEqual(["pr", "view", "101", "--json", "state,baseRefName,headRefName,headRefOid,isCrossRepository,mergeable,statusCheckRollup"]);
    expect(calls[2]).toEqual(expect.arrayContaining(["owner=acme", "name=saas", "pr=101"]));
  });

  it("a gh failure or output it cannot read is a refusal naming the step, never a green verdict", () => {
    const fail = { code: 1, stdout: "", stderr: "HTTP 502" };
    expect(readGuard(fakeGh({ repo: fail }).gh, 101, WAVE)).toEqual(Either.left("gh repo view: HTTP 502"));
    expect(readGuard(fakeGh({ view: fail }).gh, 101, WAVE)).toEqual(Either.left("gh pr view 101: HTTP 502"));
    expect(readGuard(fakeGh({ view: ok("[]") }).gh, 101, WAVE)).toEqual(Either.left("gh pr view 101: unexpected output"));
    expect(readGuard(fakeGh({ threads: fail }).gh, 101, WAVE)).toEqual(Either.left("gh api graphql (review threads of 101): HTTP 502"));
    expect(readGuard(fakeGh({ threads: ok({ data: null }) }).gh, 101, WAVE)).toEqual(Either.left("gh api graphql (review threads of 101): unexpected output"));
  });
});

describe("mergePr", () => {
  it("squash-merges only the head the guard saw, so a push after the guard cannot slip in", () => {
    const { gh, calls } = fakeGh({});
    expect(mergePr(gh, 101, SHA_A)).toEqual(Either.right(true));
    expect(calls).toEqual([["pr", "merge", "101", "--merge", "--match-head-commit", SHA_A]]);
  });

  it("a refused merge returns gh's reason", () => {
    expect(mergePr(fakeGh({ merge: { code: 1, stdout: "", stderr: "Pull request is not mergeable\n" } }).gh, 101, SHA_A)).toEqual(
      Either.left("Pull request is not mergeable"),
    );
    expect(mergePr(fakeGh({ merge: { code: 4, stdout: "", stderr: "" } }).gh, 101, SHA_A)).toEqual(Either.left("gh pr merge exited 4"));
  });
});
