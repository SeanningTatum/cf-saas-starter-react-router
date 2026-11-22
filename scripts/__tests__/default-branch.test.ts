import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { defaultBranch, isSafeBranch, run, type Deps } from "../default-branch";
import { FIX_LINE, GH_ARGS, GIT_ARGS, unsafeLine } from "../lib/default-branch-constants";
import type { GhResult } from "../lib/gh";

const ok = (stdout: string): GhResult => ({ code: 0, stdout, stderr: "" });
const failed: GhResult = { code: 1, stdout: "", stderr: "" };

function fake(answers: { gh: GhResult; git: GhResult }) {
  const calls: string[][] = [];
  const out: string[] = [];
  const err: string[] = [];
  const deps: Deps = {
    gh: (args) => {
      calls.push(["gh", ...args]);
      return answers.gh;
    },
    git: (args) => {
      calls.push(["git", ...args]);
      return answers.git;
    },
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  };
  return { deps, calls, out, err };
}

describe("defaultBranch", () => {
  it("the gh answer wins over origin/HEAD: a stale local origin/HEAD must not name the wrong branch", () => {
    const { deps, calls } = fake({ gh: ok("staging\n"), git: ok("origin/main\n") });
    expect(defaultBranch(deps)).toEqual(Either.right("staging"));
    expect(calls).toEqual([["gh", ...GH_ARGS]]);
  });

  it("gh failing falls back to origin/HEAD with origin/ cut off: no gh, no login or no network must not stop a run", () => {
    const { deps, calls } = fake({ gh: { code: 127, stdout: "", stderr: "" }, git: ok("origin/staging\n") });
    expect(defaultBranch(deps)).toEqual(Either.right("staging"));
    expect(calls).toEqual([
      ["gh", ...GH_ARGS],
      ["git", ...GIT_ARGS],
    ]);
  });

  it("an empty gh answer counts as a failure: the caller would get a blank branch name", () => {
    const { deps } = fake({ gh: ok("\n"), git: ok("origin/staging\n") });
    expect(defaultBranch(deps)).toEqual(Either.right("staging"));
  });

  it("a branch name with a slash survives: only the first origin/ is cut", () => {
    const viaGit = fake({ gh: failed, git: ok("origin/release/v3.0\n") });
    expect(defaultBranch(viaGit.deps)).toEqual(Either.right("release/v3.0"));
    const viaGh = fake({ gh: ok("feat/x_y-1\n"), git: failed });
    expect(defaultBranch(viaGh.deps)).toEqual(Either.right("feat/x_y-1"));
  });

  it("both failing gives the fix line, not a guess", () => {
    const { deps } = fake({ gh: failed, git: failed });
    expect(defaultBranch(deps)).toEqual(Either.left(FIX_LINE));
  });
});

const UNSAFE = ["$(touch pwned)", "`id`", "feat x", "-rf", "a..b", "a;b", "a|b"];

describe("unsafe branch names", () => {
  it.each(UNSAFE)("refuses %s from gh: the name is later placed in shell commands and prompts", (name) => {
    const { deps } = fake({ gh: ok(`${name}\n`), git: ok("origin/staging\n") });
    expect(defaultBranch(deps)).toEqual(Either.left(unsafeLine(name)));
  });

  it.each(UNSAFE)("refuses %s from the origin/HEAD fallback", (name) => {
    const { deps } = fake({ gh: failed, git: ok(`origin/${name}\n`) });
    expect(defaultBranch(deps)).toEqual(Either.left(unsafeLine(name)));
  });

  it.each(["release/v3.0", "feat/x_y-1", "staging", ".github"])("accepts %s", (name) => {
    expect(isSafeBranch(name)).toBe(true);
  });

  it("run prints nothing on stdout for an unsafe name and exits 1", () => {
    const { deps, out, err } = fake({ gh: ok("$(id)\n"), git: failed });
    expect(run(deps)).toBe(1);
    expect(out).toEqual([]);
    expect(err).toEqual([unsafeLine("$(id)")]);
  });
});

describe("run", () => {
  it("prints one bare line and exits 0: a caller wraps it in $(...)", () => {
    const { deps, out, err } = fake({ gh: ok("staging\n"), git: failed });
    expect(run(deps)).toBe(0);
    expect(out).toEqual(["staging"]);
    expect(err).toEqual([]);
  });

  it("both sources failing exits 1 with the fix line on stderr and nothing on stdout", () => {
    const { deps, out, err } = fake({ gh: failed, git: failed });
    expect(run(deps)).toBe(1);
    expect(out).toEqual([]);
    expect(err).toEqual([FIX_LINE]);
    expect(FIX_LINE).toContain("git remote set-head origin --auto");
  });
});
