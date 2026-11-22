import { describe, expect, it } from "vitest";
import { memoryRepo } from "../lint/repo";
import { USAGE } from "../lib/verify-plan-constants";
import { baseFor, changedPaths, run, type Deps } from "../verify-changed";

const SHA = "a".repeat(40);

function fake(answers: Record<string, string | undefined>, env: Record<string, string> = {}) {
  const calls: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const deps: Deps = {
    env,
    repo: memoryRepo({
      "scripts/lint/test-map.json": JSON.stringify({ entries: [{ match: "app/lib/**", kind: "unit" }] }),
      "app/lib/sum.ts": "export const sum = 1;\n",
      "app/lib/new.ts": "export const fresh = 1;\n",
    }),
    git: (args) => {
      const key = args.join(" ");
      calls.push(key);
      return answers[key];
    },
    pullRequestTarget: () => undefined,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  };
  return { deps, calls, out, err };
}

const diffKey = `diff --name-only --no-renames -z ${SHA}`;
const untrackedKey = "ls-files --others --exclude-standard -z";

describe("baseFor", () => {
  it("a named base is the merge base of HEAD and that ref, so commits that landed on the base since are not counted as changed", () => {
    const { deps } = fake({ "merge-base HEAD v3/w1-1": SHA });
    expect(baseFor(deps, "v3/w1-1")).toEqual({ found: true, sha: SHA, from: "v3/w1-1" });
  });

  it("with no name it follows the linter's order, GITHUB_BASE_REF first in CI", () => {
    const { deps } = fake({ "rev-parse --verify --quiet origin/v3/wave-1^{commit}": SHA, "merge-base HEAD origin/v3/wave-1": SHA }, { GITHUB_BASE_REF: "v3/wave-1" });
    expect(baseFor(deps, undefined)).toEqual({ found: true, sha: SHA, from: "GITHUB_BASE_REF, v3/wave-1" });
  });
});

describe("changedPaths", () => {
  it("joins the diff against the base with untracked files, once each and sorted: a new file not yet added still counts", () => {
    const { deps } = fake({ [diffKey]: "app/lib/sum.ts\u0000app/lib/old.ts\u0000", [untrackedKey]: "app/lib/new.ts\u0000app/lib/sum.ts\u0000" });
    expect(changedPaths(deps, SHA)).toEqual(["app/lib/new.ts", "app/lib/old.ts", "app/lib/sum.ts"]);
  });

  it("is undefined when git diff fails, so the caller can fall back to the full run", () => {
    expect(changedPaths(fake({}).deps, SHA)).toBeUndefined();
  });
});

describe("run", () => {
  it("prints the base and a lean plan for the changed files", () => {
    const { deps, out, err } = fake({ "merge-base HEAD v3/w1-1": SHA, [diffKey]: "app/lib/sum.ts\u0000", [untrackedKey]: "" });
    expect(run(["v3/w1-1"], deps)).toBe(0);
    expect(err).toEqual([]);
    expect(out[0]).toBe("base|aaaaaaa (v3/w1-1)");
    expect(out).toContain("run|test|bunx vitest related --run --passWithNoTests 'app/lib/sum.ts'");
  });

  it("asks for the full run when no base can be found: with nothing to diff against, lean has nothing to choose from", () => {
    const { deps, out } = fake({});
    expect(run([], deps)).toBe(0);
    expect(out).toEqual(["full|no base branch found (tried: none named)"]);
  });

  it("asks for the full run when git diff fails", () => {
    const { deps, out } = fake({ "merge-base HEAD v3/w1-1": SHA });
    expect(run(["v3/w1-1"], deps)).toBe(0);
    expect(out.at(-1)).toBe("full|git diff against v3/w1-1 failed");
  });

  it("exits 2 on a named base with no merge base: a typo must not silently run every gate", () => {
    const { deps, out, err } = fake({});
    expect(run(["nope"], deps)).toBe(2);
    expect(out).toEqual([]);
    expect(err[0]).toContain("nope has no merge base with HEAD");
  });

  it.each([[["a", "b"]], [["--all"]]])("exits 2 with the usage on %j", (argv) => {
    const { deps, err, calls } = fake({});
    expect(run(argv, deps)).toBe(2);
    expect(err).toEqual([USAGE]);
    expect(calls).toEqual([]);
  });
});
