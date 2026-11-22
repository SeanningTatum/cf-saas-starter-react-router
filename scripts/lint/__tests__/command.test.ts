import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCommand, withoutGitVariables } from "../command";

const repoRoot = () => join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const hookEnvironment = () => ({
  ...process.env,
  GIT_DIR: "/nowhere/a-commit-hook-set-this",
  GIT_WORK_TREE: "/nowhere/work-tree",
  GIT_INDEX_FILE: "/nowhere/index",
});

describe("withoutGitVariables", () => {
  it("drops every GIT_ variable a commit hook sets and keeps the rest, so a child git finds its repo from cwd alone", () => {
    const cleaned = withoutGitVariables({ GIT_DIR: "a", GIT_WORK_TREE: "b", GIT_INDEX_FILE: "c", GIT_EDITOR: "true", PATH: "/bin", HOME: "/home/x" });

    expect(cleaned).toEqual({ PATH: "/bin", HOME: "/home/x" });
  });

  it("keeps a variable that only contains GIT in its name", () => {
    expect(withoutGitVariables({ DIGIT_COUNT: "3", LEGIT_FLAG: "1" })).toEqual({ DIGIT_COUNT: "3", LEGIT_FLAG: "1" });
  });
});

describe("runCommand", () => {
  it("hands the child no GIT_ variable even when the parent runs inside a commit hook", () => {
    const names = runCommand("env", [], { cwd: repoRoot(), env: hookEnvironment() })
      ?.split("\n")
      .map((line) => line.split("=")[0]);

    expect(names).toBeDefined();
    expect(names?.filter((name) => name?.startsWith("GIT_"))).toEqual([]);
  });

  it("lets a read-only git command find this repo from cwd while GIT_DIR points nowhere, which fails when the variable leaks", () => {
    const gitDir = runCommand("git", ["rev-parse", "--git-dir"], { cwd: repoRoot(), env: hookEnvironment() });

    expect(gitDir).toBeDefined();
    expect(gitDir).not.toContain("a-commit-hook-set-this");
  });

  it("runs the child in the cwd it is given, not the caller's", () => {
    expect(runCommand("pwd", [], { cwd: "/", env: hookEnvironment() })).toBe("/");
  });

  it("returns undefined for a command that exits non-zero", () => {
    expect(runCommand("false", [], { cwd: repoRoot(), env: {} })).toBeUndefined();
  });
});
