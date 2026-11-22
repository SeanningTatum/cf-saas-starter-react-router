import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { envOutsideAnyHook, GIT_IDENTITY as IDENTITY, NO_GLOBAL_CONFIG, useGitSandbox } from "./helpers/git-sandbox";

const SCRIPT = path.join(__dirname, "..", "..", ".github", "scripts", "next-version.sh");
const LONG_BODY_BYTES = 600_000;

const { repos, hookDecoy } = useGitSandbox("next-version");

const git = (cwd: string, ...args: string[]): string => {
  const result = spawnSync("git", [...IDENTITY, ...args], {
    cwd,
    encoding: "utf-8",
    env: envOutsideAnyHook(process.env),
  });
  expect(result.status, `git ${args.join(" ")}: ${result.stderr}`).toBe(0);
  return result.stdout;
};

const newRepo = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "next-version-"));
  repos.push(dir);
  git(dir, "init", "--quiet", "--initial-branch=main");
  return dir;
};

const commit = (cwd: string, message: string): void => {
  git(cwd, "commit", "--quiet", "--allow-empty", "-m", message);
};

const commitFromFile = (cwd: string, message: string): void => {
  const file = path.join(cwd, ".git", "COMMIT_MSG_TEST");
  fs.writeFileSync(file, message);
  git(cwd, "commit", "--quiet", "--allow-empty", "-F", file);
};

const tag = (cwd: string, name: string): void => {
  git(cwd, "tag", name);
};

const run = (cwd: string, script: string = SCRIPT): Record<string, string> => {
  const result = spawnSync("bash", [script], {
    cwd,
    encoding: "utf-8",
    env: envOutsideAnyHook(process.env),
  });
  expect(result.status, result.stderr).toBe(0);
  return Object.fromEntries(
    result.stdout
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
};

const longBody = (): string => {
  const line = "filler line that is not a conventional commit header\n";
  return line.repeat(Math.ceil(LONG_BODY_BYTES / line.length));
};

describe("the temp repos of this file", () => {
  it("never pass a git hook's GIT_DIR, GIT_WORK_TREE or GIT_INDEX_FILE to a child: run from a pre-commit hook, git init once re-initialised the real repo as bare", () => {
    const hookEnv = {
      PATH: "/usr/bin",
      GIT_DIR: "/somewhere/real/.git",
      GIT_WORK_TREE: "/somewhere/real",
      GIT_INDEX_FILE: "/somewhere/real/.git/index",
      GIT_PREFIX: "scripts/",
    };
    expect(envOutsideAnyHook(hookEnv)).toEqual({ PATH: "/usr/bin", ...NO_GLOBAL_CONFIG });
  });

  it("every test here runs as if inside a hook: GIT_DIR, GIT_WORK_TREE and GIT_INDEX_FILE point at a decoy", () => {
    expect(process.env.GIT_DIR).toBe(hookDecoy.dir);
    expect(process.env.GIT_WORK_TREE).toBe(path.join(hookDecoy.dir, "work"));
    expect(process.env.GIT_INDEX_FILE).toBe(path.join(hookDecoy.dir, "index"));
  });

  it("are made inside the temp folder even when GIT_DIR points elsewhere", () => {
    const repo = newRepo();
    commit(repo, "fix: first");
    tag(repo, "v0.0.1");
    run(repo);
    expect(git(repo, "rev-list", "--count", "HEAD").trim()).toBe("1");
    expect(git(repo, "tag", "--list").trim()).toBe("v0.0.1");
    expect(fs.existsSync(path.join(repo, ".git", "HEAD"))).toBe(true);
    expect(fs.readdirSync(hookDecoy.dir)).toEqual([]);
  });
});

describe("next-version.sh", () => {
  it("starts from v0.0.0 when no tag exists, so a first fix gives v0.0.1", () => {
    const repo = newRepo();
    commit(repo, "fix: first");
    expect(run(repo)).toMatchObject({ skip: "false", last: "v0.0.0", bump: "patch", next: "v0.0.1" });
  });

  it("reads feat after v1.2.3 as minor, so the next tag is v1.3.0", () => {
    const repo = newRepo();
    commit(repo, "chore: init");
    tag(repo, "v1.2.3");
    commit(repo, "feat: add thing");
    expect(run(repo)).toMatchObject({ last: "v1.2.3", bump: "minor", next: "v1.3.0" });
  });

  it("reads fix after v1.2.3 as patch, so the next tag is v1.2.4", () => {
    const repo = newRepo();
    commit(repo, "chore: init");
    tag(repo, "v1.2.3");
    commit(repo, "fix: repair thing");
    expect(run(repo)).toMatchObject({ bump: "patch", next: "v1.2.4" });
  });

  it("reads a bang subject (feat!:) as major, so the next tag is v2.0.0", () => {
    const repo = newRepo();
    commit(repo, "chore: init");
    tag(repo, "v1.2.3");
    commit(repo, "feat!: drop old api");
    expect(run(repo)).toMatchObject({ bump: "major", next: "v2.0.0" });
  });

  it("reads a scoped bang subject (feat(api)!:) as major, so a scope does not hide the break", () => {
    const repo = newRepo();
    commit(repo, "chore: init");
    tag(repo, "v1.2.3");
    commit(repo, "feat(api)!: drop old route");
    expect(run(repo)).toMatchObject({ bump: "major", next: "v2.0.0" });
  });

  it("reads a BREAKING CHANGE: footer under a fix subject as major, so the footer is not ignored", () => {
    const repo = newRepo();
    commit(repo, "chore: init");
    tag(repo, "v1.2.3");
    commit(repo, "fix: change default\n\nBREAKING CHANGE: the default is now off");
    expect(run(repo)).toMatchObject({ bump: "major", next: "v2.0.0" });
  });

  it("reads a BREAKING-CHANGE: footer as major, so the hyphen spelling counts too", () => {
    const repo = newRepo();
    commit(repo, "chore: init");
    tag(repo, "v1.2.3");
    commit(repo, "fix: change default\n\nBREAKING-CHANGE: the default is now off");
    expect(run(repo)).toMatchObject({ bump: "major", next: "v2.0.0" });
  });

  it("reads a body line that starts with feat: under a fix subject as minor, because the log it scans holds bodies as well as subjects (as in .github/scripts/next-version.sh on the staging branch)", () => {
    const repo = newRepo();
    commit(repo, "chore: init");
    tag(repo, "v1.2.3");
    commit(repo, "fix: repair thing\n\nfeat: this line is body text");
    expect(run(repo)).toMatchObject({ bump: "minor", next: "v1.3.0" });
  });

  it("prints skip=true when HEAD already carries a version tag, so a re-run does not cut a second release", () => {
    const repo = newRepo();
    commit(repo, "feat: add thing");
    tag(repo, "v1.0.0");
    expect(run(repo)).toEqual({ skip: "true" });
  });

  it("ignores a non-version tag on HEAD, so a stray tag does not skip the release", () => {
    const repo = newRepo();
    commit(repo, "fix: thing");
    tag(repo, "v1.0.0-rc1");
    expect(run(repo)).toMatchObject({ skip: "false", next: "v0.0.1" });
  });

  it("finds a tag that sits on another branch through the merge base", () => {
    const repo = newRepo();
    commit(repo, "chore: base");
    git(repo, "switch", "--quiet", "-c", "release");
    commit(repo, "fix: release only");
    tag(repo, "v1.0.0");
    git(repo, "switch", "--quiet", "main");
    commit(repo, "feat: on main");
    expect(run(repo)).toMatchObject({ last: "v1.0.0", bump: "minor", next: "v1.1.0" });
  });

  it("reads a merge commit that brings in a squashed feat commit as minor, not patch", () => {
    const repo = newRepo();
    commit(repo, "chore: init");
    tag(repo, "v1.0.0");
    git(repo, "switch", "--quiet", "-c", "staging");
    commit(repo, "feat: add thing (#5)");
    git(repo, "switch", "--quiet", "main");
    git(repo, "merge", "--quiet", "--no-ff", "-m", "Merge pull request #6 from owner/staging", "staging");
    expect(run(repo)).toMatchObject({ last: "v1.0.0", bump: "minor", next: "v1.1.0" });
  });

  it.each([
    { subject: "feat!: drop old api", bump: "major", next: "v2.0.0" },
    { subject: "feat: add thing", bump: "minor", next: "v1.1.0" },
  ])(
    "still reads $subject as $bump when an older commit body is far larger than a pipe buffer (a quiet grep exits at the first match, the writer dies on the closed pipe, and pipefail turns the break into a patch)",
    ({ subject, bump, next }) => {
      const repo = newRepo();
      commit(repo, "chore: init");
      tag(repo, "v1.0.0");
      commitFromFile(repo, `chore: old notes\n\n${longBody()}`);
      commit(repo, subject);
      expect(run(repo)).toMatchObject({ bump, next });
    },
  );

  it("gives v3.0.0 for one squash commit titled feat!: v3.0 after v2.4.0, the v3.0 release", () => {
    const repo = newRepo();
    commit(repo, "chore: init");
    tag(repo, "v2.4.0");
    commit(repo, "feat!: v3.0");
    expect(run(repo)).toMatchObject({ last: "v2.4.0", bump: "major", next: "v3.0.0" });
  });

  it("picks the highest version tag by number, so v2.10.0 beats v2.9.0", () => {
    const repo = newRepo();
    commit(repo, "chore: init");
    tag(repo, "v2.9.0");
    commit(repo, "chore: more");
    tag(repo, "v2.10.0");
    commit(repo, "fix: thing");
    expect(run(repo)).toMatchObject({ last: "v2.10.0", next: "v2.10.1" });
  });
});

describe("next-version.sh source", () => {
  const text = fs.readFileSync(SCRIPT, "utf-8");

  it("never calls grep with the quiet flag, so a long log cannot be read as no match", () => {
    expect(text).not.toMatch(/grep\s+(-[a-zA-Z]*q|--quiet|--silent)/);
  });

  it("is executable, so release.yml can run it by path", () => {
    expect(fs.statSync(SCRIPT).mode & 0o111).not.toBe(0);
  });
});
