import { Either } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { addWorktree, childEnv, realShell, removeWorktree, resolveCommit, step, tail, type Shell } from "../shell";

function fake(fail?: RegExp) {
  const calls: string[] = [];
  const shell: Shell = {
    cwd: "/repo",
    run: (command, args, cwd) => {
      const line = `${cwd}: ${command} ${args.join(" ")}`;
      calls.push(line);
      return fail?.test(line) ? { code: 1, stdout: "", stderr: "fatal: bad ref" } : { code: 0, stdout: "abc\n", stderr: "" };
    },
    read: () => undefined,
    write: () => {},
    tempDir: (prefix) => `/tmp/${prefix}1`,
    remove: (path) => calls.push(`remove ${path}`),
    out: () => {},
    err: () => {},
  };
  return { shell, calls };
}

describe("step and tail", () => {
  it("keeps the last five lines of a failed command, stderr first, and names the command and folder", () => {
    const lines = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join("\n");
    expect(tail({ code: 1, stdout: lines, stderr: "" })).toBe("line 4\nline 5\nline 6\nline 7\nline 8");
    const { shell } = fake(/build/);
    expect(step(shell, "bun", ["run", "build"], "/w")).toEqual(Either.left("`bun run build` failed in /w:\nfatal: bad ref"));
  });
});

describe("temporary worktrees", () => {
  it("resolves the ref to a commit, adds a detached worktree at it in a fresh temp folder, and removes both", () => {
    const { shell, calls } = fake();
    expect(resolveCommit(shell, "origin/staging")).toEqual(Either.right("abc"));
    expect(addWorktree(shell, "abc", "size-base-")).toEqual(Either.right("/tmp/size-base-1"));
    removeWorktree(shell, "/tmp/size-base-1");
    expect(calls).toEqual([
      "/repo: git rev-parse --verify origin/staging^{commit}",
      "/repo: git worktree add --detach /tmp/size-base-1 abc",
      "/repo: git worktree remove --force /tmp/size-base-1",
      "remove /tmp/size-base-1",
    ]);
  });

  it("fails on a ref that names no commit", () => {
    expect(Either.isLeft(resolveCommit(fake(/rev-parse/).shell, "nope"))).toBe(true);
  });
});

describe("child processes", () => {
  const saved = process.env.GIT_DIR;
  afterEach(() => {
    if (saved === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = saved;
  });

  it("drop GIT_* variables, so a git hook's GIT_DIR cannot point a worktree command at the wrong repository, and take the extra variables", () => {
    process.env.GIT_DIR = "/elsewhere/.git";
    const env = childEnv({ CI: "1" });
    expect(env.GIT_DIR).toBeUndefined();
    expect(env.CI).toBe("1");
    const result = realShell({ CI: "1" }).run("sh", ["-c", 'printf "%s|%s" "${GIT_DIR:-none}" "$CI"'], process.cwd());
    expect(result).toEqual({ code: 0, stdout: "none|1", stderr: "" });
  });
});
