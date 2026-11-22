import { describe, expect, it } from "vitest";
import { resolveBase, type BaseDeps } from "../base-ref";
import { recordedGit } from "./fixtures";

const tip = (ref: string) => `rev-parse --verify --quiet ${ref}^{commit}`;
const mergeBase = (ref: string) => `merge-base HEAD ${ref}`;

const localRepo = (extra: Record<string, string> = {}): Record<string, string> => ({
  "rev-parse --abbrev-ref HEAD": "feature",
  "symbolic-ref --short refs/remotes/origin/HEAD": "origin/main",
  [tip("origin/main")]: "main-tip",
  [mergeBase("origin/main")]: "main-base",
  [tip("origin/staging")]: "staging-tip",
  [mergeBase("origin/staging")]: "staging-base",
  [tip("origin/release")]: "release-tip",
  [mergeBase("origin/release")]: "release-base",
  ...extra,
});

function deps(outputs: Record<string, string>, env: Record<string, string> = {}, target?: string) {
  const recorded = recordedGit(outputs);
  const asked: string[] = [];
  const base: BaseDeps = {
    env,
    git: recorded.git,
    pullRequestTarget: () => {
      asked.push("pullRequestTarget");
      return target;
    },
  };
  return { base, calls: recorded.calls, asked };
}

describe("resolveBase in CI", () => {
  it("lets GITHUB_BASE_REF win over a recorded target, the gh target and the default branch, and returns the merge base", () => {
    const { base, asked } = deps(localRepo({ "config --get branch.feature.gh-merge-base": "staging" }), { GITHUB_BASE_REF: "release" }, "main");

    expect(resolveBase(base)).toEqual({ found: true, sha: "release-base", from: "GITHUB_BASE_REF, release" });
    expect(asked).toEqual([]);
  });

  it("falls back to the branch tip when merge-base fails, as in a shallow clone", () => {
    const outputs = localRepo();
    delete outputs[mergeBase("origin/release")];

    expect(resolveBase(deps(outputs, { GITHUB_BASE_REF: "release" }).base)).toMatchObject({ found: true, sha: "release-tip" });
  });

  it("fails as required, without falling back to the default branch, when GITHUB_BASE_REF names a ref git cannot read", () => {
    expect(resolveBase(deps(localRepo(), { GITHUB_BASE_REF: "gone" }).base)).toEqual({ found: false, required: true, tried: ["gone"] });
  });

  it("treats an empty GITHUB_BASE_REF, which GitHub sets on push events, as no CI base", () => {
    expect(resolveBase(deps(localRepo(), { GITHUB_BASE_REF: "" }).base)).toEqual({
      found: true,
      sha: "main-base",
      from: "the default branch, main",
    });
  });

  it("refuses a branch name that starts with a dash, so it never reaches git as an option", () => {
    const { base, calls } = deps(localRepo(), { GITHUB_BASE_REF: "--output=/tmp/x" });

    expect(resolveBase(base)).toEqual({ found: false, required: true, tried: ["--output=/tmp/x"] });
    expect(calls.filter((call) => call.includes("--output"))).toEqual([]);
  });
});

describe("resolveBase on a laptop", () => {
  it("prefers the recorded branch.<current>.gh-merge-base over asking gh", () => {
    const { base, asked } = deps(localRepo({ "config --get branch.feature.gh-merge-base": "staging" }), {}, "release");

    expect(resolveBase(base)).toEqual({ found: true, sha: "staging-base", from: "the pull request's target, staging" });
    expect(asked).toEqual([]);
  });

  it("asks pullRequestTarget when no merge base is recorded", () => {
    expect(resolveBase(deps(localRepo(), {}, "release").base)).toEqual({
      found: true,
      sha: "release-base",
      from: "the pull request's target, release",
    });
  });

  it("falls through to the default branch from refs/remotes/origin/HEAD when there is no pull request", () => {
    expect(resolveBase(deps(localRepo(), {}, undefined).base)).toEqual({
      found: true,
      sha: "main-base",
      from: "the default branch, main",
    });
  });

  it("falls through to the default branch when the pull request target does not resolve", () => {
    expect(resolveBase(deps(localRepo(), {}, "deleted").base)).toMatchObject({ found: true, sha: "main-base" });
  });

  it("gives found: false, required: false when nothing resolves, so a laptop without a remote is not blocked", () => {
    expect(resolveBase(deps({ "rev-parse --abbrev-ref HEAD": "feature" }, {}, "release").base)).toEqual({
      found: false,
      required: false,
      tried: ["release"],
    });
  });

  it("prefers origin/<branch> over a stale local branch of the same name", () => {
    const outputs = localRepo({ [tip("main")]: "local-tip", [mergeBase("main")]: "local-base" });

    expect(resolveBase(deps(outputs).base)).toMatchObject({ sha: "main-base" });
  });

  it("uses a local branch when origin has no branch of that name", () => {
    const outputs = { [tip("trunk")]: "trunk-tip", [mergeBase("trunk")]: "trunk-base" };

    expect(resolveBase(deps(outputs, {}, "trunk").base)).toMatchObject({ found: true, sha: "trunk-base" });
  });

  it("refuses a pull request target that starts with a dash and moves on to the default branch", () => {
    const { base, calls } = deps(localRepo(), {}, "-c");

    expect(resolveBase(base)).toMatchObject({ found: true, sha: "main-base" });
    expect(calls.join("\n")).not.toMatch(/(^| |\/)-c(\^| |$)/m);
  });
});
