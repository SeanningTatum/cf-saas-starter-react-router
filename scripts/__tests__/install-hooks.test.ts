import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  chooseScope,
  ciIsOn,
  gitRunner,
  realFileOps,
  run,
  withoutGitVariables,
  type Deps,
  type FileOps,
  type GitResult,
} from "../install-hooks";
import { envOutsideAnyHook, GIT_IDENTITY, useGitSandbox } from "./helpers/git-sandbox";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FAKE_ROOT = "/fake/checkout";
const HOOKS_PATH = ".husky/_";
const REAL_GIT_TIMEOUT_MS = 60_000;

vi.setConfig({ testTimeout: REAL_GIT_TIMEOUT_MS });
const EXECUTABLE_BITS = 0o777;
const BAD_MESSAGE = "this message has no type";
const GOOD_MESSAGE = "feat(ui): add a thing";

const { makeDir } = useGitSandbox("install-hooks");

interface Fake {
  deps: Deps;
  gitCalls: string[][];
  gitWrites: string[][];
  written: Map<string, { content: string; mode: number | undefined }>;
  copied: string[][];
  removed: string[];
  lines: string[];
}

interface FakeOptions {
  env?: Record<string, string | undefined>;
  answers?: Record<string, GitResult>;
  withHusky?: boolean;
  hooks?: string[];
  failWrite?: boolean;
}

const ok = (stdout: string): GitResult => ({ status: 0, stdout });
const failed: GitResult = { status: 1, stdout: "" };

const isGitWrite = (args: readonly string[]): boolean => args[0] === "config" && !args.includes("--get");

const fake = (options: FakeOptions = {}): Fake => {
  const answers: Record<string, GitResult> = {
    "rev-parse --is-inside-work-tree": ok("true\n"),
    "rev-parse --show-toplevel": ok(`${FAKE_ROOT}\n`),
    "config --type=bool --get extensions.worktreeConfig": failed,
    "rev-parse --git-path config": ok(".git/config\n"),
    "rev-parse --git-path config.worktree": ok(".git/config.worktree\n"),
    ...options.answers,
  };
  const gitCalls: string[][] = [];
  const gitWrites: string[][] = [];
  const written = new Map<string, { content: string; mode: number | undefined }>();
  const copied: string[][] = [];
  const removed: string[] = [];
  const lines: string[] = [];
  const files: FileOps = {
    exists: () => options.withHusky !== false,
    listFiles: () => options.hooks ?? ["pre-commit", "commit-msg"],
    makeDir: () => undefined,
    realPath: (file) => file,
    remove: (file) => {
      removed.push(file);
    },
    write: (file, content, mode) => {
      if (options.failWrite) throw new Error("disk full");
      written.set(file, { content, mode });
    },
    copy: (from, to) => {
      copied.push([from, to]);
    },
  };
  const deps: Deps = {
    env: options.env ?? {},
    git: (args) => {
      gitCalls.push([...args]);
      if (isGitWrite(args)) gitWrites.push([...args]);
      return answers[args.join(" ")] ?? (isGitWrite(args) ? ok("") : failed);
    },
    files,
    log: (line) => {
      lines.push(line);
    },
    root: FAKE_ROOT,
  };
  return { deps, gitCalls, gitWrites, written, copied, removed, lines };
};

describe("installer skip cases", () => {
  const cases: [string, FakeOptions, string][] = [
    ["HUSKY=0 (the owner turned husky off)", { env: { HUSKY: "0" } }, "HUSKY=0"],
    ["CI=true (a CI install must never touch git config)", { env: { CI: "true" } }, "CI"],
    ["CI=1 (some runners set 1, not true)", { env: { CI: "1" } }, "CI"],
    [
      "a directory that is not a work tree (a tarball or a bare repository)",
      { answers: { "rev-parse --is-inside-work-tree": { status: 128, stdout: "" } } },
      "not inside a git work tree",
    ],
    [
      "a bare repository, where git answers false",
      { answers: { "rev-parse --is-inside-work-tree": ok("false\n") } },
      "not inside a git work tree",
    ],
    [
      "git missing from the machine",
      { answers: { "rev-parse --is-inside-work-tree": { status: null, stdout: "" } } },
      "git is not installed",
    ],
    [
      "a folder inside another repository, where git resolves a different top",
      { answers: { "rev-parse --show-toplevel": ok("/fake\n") } },
      "this folder is not the top of its git work tree",
    ],
    ["a production install with no husky runtime", { withHusky: false }, "husky is not installed"],
  ];

  it.each(cases)("%s: writes no git config, writes no file and exits 0", (_title, options, reason) => {
    const f = fake(options);
    expect(run(f.deps)).toBe(0);
    expect(f.gitWrites).toEqual([]);
    expect(f.written.size).toBe(0);
    expect(f.copied).toEqual([]);
    expect(f.lines).toHaveLength(1);
    expect(f.lines[0]).toContain(`hooks: skipped, ${reason}`);
  });

  it("HUSKY=0 wins over a missing git, so no git process starts", () => {
    const f = fake({ env: { HUSKY: "0" } });
    run(f.deps);
    expect(f.gitCalls).toEqual([]);
  });

  it.each([["false"], [""], ["0"]])("CI=%j counts as off and does not skip the install", (value) => {
    const f = fake({ env: { CI: value } });
    run(f.deps);
    expect(f.lines[0]).toContain("hooks: on for");
    expect(f.gitWrites).toHaveLength(1);
  });

  it("ciIsOn treats an unset CI as off", () => {
    expect(ciIsOn(undefined)).toBe(false);
  });
});

describe("installer scope", () => {
  const extensionOn = { "config --type=bool --get extensions.worktreeConfig": ok("true\n") };

  it("with extensions.worktreeConfig on, writes --worktree and never the shared form that would switch hooks on in every worktree", () => {
    const f = fake({ answers: extensionOn });
    run(f.deps);
    expect(f.gitWrites).toEqual([["config", "--worktree", "core.hooksPath", HOOKS_PATH]]);
    expect(f.gitWrites.some((args) => args[1] === "core.hooksPath")).toBe(false);
  });

  it("with the extension off, writes the plain form husky itself writes", () => {
    const f = fake();
    run(f.deps);
    expect(f.gitWrites).toEqual([["config", "core.hooksPath", HOOKS_PATH]]);
  });

  it("reads the value in the scope it will write, so a shared value does not hide a missing worktree value", () => {
    const f = fake({ answers: extensionOn });
    run(f.deps);
    expect(f.gitCalls).toContainEqual(["config", "--worktree", "--get", "core.hooksPath"]);
    expect(f.gitCalls).not.toContainEqual(["config", "--local", "--get", "core.hooksPath"]);
  });

  it("issues no write when the value is already set, so a second install leaves config alone", () => {
    const f = fake({ answers: { "config --local --get core.hooksPath": ok(`${HOOKS_PATH}\n`) } });
    run(f.deps);
    expect(f.gitWrites).toEqual([]);
    expect(f.lines[0]).toContain("hooks: already on for this repository");
  });

  it("rewrites the wrapper files even when the value is already set, so a new hook file gets its wrapper", () => {
    const f = fake({ answers: { "config --local --get core.hooksPath": ok(`${HOOKS_PATH}\n`) } });
    run(f.deps);
    expect(f.written.has(path.join(FAKE_ROOT, ".husky", "_", "commit-msg"))).toBe(true);
  });

  it("names the worktree scope and the config file in the printed line", () => {
    const f = fake({ answers: extensionOn });
    run(f.deps);
    expect(f.lines).toEqual([
      `hooks: on for this worktree (core.hooksPath=${HOOKS_PATH} in ${path.join(FAKE_ROOT, ".git/config.worktree")})`,
    ]);
  });

  it("names the repository scope and the config file in the printed line", () => {
    const f = fake();
    run(f.deps);
    expect(f.lines).toEqual([
      `hooks: on for this repository (core.hooksPath=${HOOKS_PATH} in ${path.join(FAKE_ROOT, ".git/config")}, shared by all its worktrees)`,
    ]);
  });

  it("chooseScope picks --worktree only when the extension is on", () => {
    expect(chooseScope(true).write).toContain("--worktree");
    expect(chooseScope(false).write).not.toContain("--worktree");
  });
});

describe("installer files", () => {
  it("writes h, .gitignore and one executable wrapper per hook file, in the layout husky uses", () => {
    const f = fake({ hooks: ["commit-msg"] });
    run(f.deps);
    const dir = path.join(FAKE_ROOT, ".husky", "_");
    expect(f.copied).toEqual([[path.join(FAKE_ROOT, "node_modules/husky/husky"), path.join(dir, "h")]]);
    expect(f.written.get(path.join(dir, ".gitignore"))).toEqual({ content: "*", mode: undefined });
    expect(f.written.get(path.join(dir, "commit-msg"))).toEqual({
      content: '#!/usr/bin/env sh\n. "$(dirname "$0")/h"',
      mode: 0o755,
    });
    expect([...f.written.keys()].sort()).toEqual([path.join(dir, ".gitignore"), path.join(dir, "commit-msg")]);
  });

  it("removes each file before it writes it, so a symlink left in .husky/_ is not written through", () => {
    const f = fake({ hooks: ["commit-msg"] });
    run(f.deps);
    const dir = path.join(FAKE_ROOT, ".husky", "_");
    expect(f.removed.sort()).toEqual([
      path.join(dir, ".gitignore"),
      path.join(dir, "commit-msg"),
      path.join(dir, "h"),
    ]);
  });

  it("withoutGitVariables drops every GIT_ key, so a hook's GIT_DIR never reaches the git child", () => {
    expect(withoutGitVariables({ PATH: "/usr/bin", GIT_DIR: "/x", GIT_WORK_TREE: "/y", GIT_CONFIG_COUNT: "1" })).toEqual({
      PATH: "/usr/bin",
    });
  });

  it("a write that throws ends in a skip line with exit 0 and never touches git config", () => {
    const f = fake({ failWrite: true });
    expect(run(f.deps)).toBe(0);
    expect(f.gitWrites).toEqual([]);
    expect(f.lines[0]).toContain("hooks: skipped, could not write .husky/_ (disk full)");
  });

  it("a git config that refuses the value ends in a skip line with exit 0", () => {
    const f = fake({ answers: { "config core.hooksPath .husky/_": failed } });
    expect(run(f.deps)).toBe(0);
    expect(f.lines[0]).toContain("git config refused");
  });
});

const initDir = { dir: "" };

beforeEach(() => {
  initDir.dir = makeDir("hooks-xdg");
});

const hookEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => {
  const scrubbed = Object.fromEntries(
    Object.entries(envOutsideAnyHook(process.env)).filter(([key]) => key !== "HUSKY" && key !== "CI"),
  );
  return { ...scrubbed, HOME: initDir.dir, XDG_CONFIG_HOME: initDir.dir, ...extra };
};

const git = (cwd: string, args: string[], env: NodeJS.ProcessEnv = hookEnv()) =>
  spawnSync("git", [...GIT_IDENTITY, ...args], { cwd, encoding: "utf-8", env });

const mustGit = (cwd: string, ...args: string[]): string => {
  const result = git(cwd, args);
  expect(result.status, `git ${args.join(" ")}: ${result.stderr}`).toBe(0);
  return result.stdout;
};

const scaffold = (dir: string, hooks: string[]): void => {
  fs.mkdirSync(path.join(dir, ".husky"));
  for (const hook of hooks) fs.copyFileSync(path.join(REPO_ROOT, ".husky", hook), path.join(dir, ".husky", hook));
  fs.copyFileSync(path.join(REPO_ROOT, ".commitlintrc.json"), path.join(dir, ".commitlintrc.json"));
  fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(dir, "node_modules"));
};

const initRepo = (prefix: string): string => {
  const dir = makeDir(prefix);
  mustGit(dir, "init", "--quiet", "--initial-branch=main");
  return dir;
};

const installIn = (dir: string): string => {
  const lines: string[] = [];
  const deps: Deps = {
    env: {},
    git: gitRunner(dir, hookEnv()),
    files: realFileOps(),
    log: (line) => {
      lines.push(line);
    },
    root: dir,
  };
  expect(run(deps)).toBe(0);
  return lines.join("\n");
};

const commitEmpty = (cwd: string, message: string, env: NodeJS.ProcessEnv = hookEnv()) =>
  git(cwd, ["commit", "--quiet", "--allow-empty", "-m", message], env);

const readText = (...parts: string[]): string => fs.readFileSync(path.join(...parts), "utf-8");

describe("installer against real git in a throwaway repository", () => {
  it(
    "a plain repository refuses a message with no type and accepts a conventional one, so the hook runs and is not simply broken",
    () => {
      const repo = initRepo("hooks-plain");
      scaffold(repo, ["commit-msg"]);
      const line = installIn(repo);

      expect(line).toBe(
        `hooks: on for this repository (core.hooksPath=${HOOKS_PATH} in ${path.join(repo, ".git", "config")}, shared by all its worktrees)`,
      );
      const refused = commitEmpty(repo, BAD_MESSAGE);
      expect(refused.status).not.toBe(0);
      expect(refused.stderr).toContain("type may not be empty");
      expect(commitEmpty(repo, GOOD_MESSAGE).status).toBe(0);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "HUSKY=0 at commit time lets a bad message through, so the emergency switch still works",
    () => {
      const repo = initRepo("hooks-off");
      scaffold(repo, ["commit-msg"]);
      installIn(repo);
      expect(commitEmpty(repo, BAD_MESSAGE, hookEnv({ HUSKY: "0" })).status).toBe(0);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it("a second install in the same repository leaves the config file byte for byte as it was", () => {
    const repo = initRepo("hooks-twice");
    scaffold(repo, ["commit-msg"]);
    installIn(repo);
    const before = readText(repo, ".git", "config");
    const second = installIn(repo);
    expect(second).toContain("hooks: already on for this repository");
    expect(readText(repo, ".git", "config")).toBe(before);
  });

  it(
    "with extensions.worktreeConfig on, the install in a linked worktree leaves the shared config alone, turns hooks on in that worktree only and the main checkout keeps its own state",
    () => {
      const main = initRepo("hooks-main");
      mustGit(main, "config", "extensions.worktreeConfig", "true");
      scaffold(main, ["commit-msg"]);
      mustGit(main, "add", ".husky", ".commitlintrc.json");
      mustGit(main, "commit", "--quiet", "-m", "chore: scaffold");
      const linked = path.join(makeDir("hooks-linked-parent"), "wt");
      mustGit(main, "worktree", "add", "--quiet", "-b", "topic", linked);
      fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(linked, "node_modules"));
      const sharedBefore = readText(main, ".git", "config");

      const linkedLine = installIn(linked);
      const linkedConfig = path.join(main, ".git", "worktrees", "wt", "config.worktree");
      expect(linkedLine).toBe(`hooks: on for this worktree (core.hooksPath=${HOOKS_PATH} in ${linkedConfig})`);
      expect(readText(main, ".git", "config")).toBe(sharedBefore);
      expect(readText(linkedConfig)).toContain(`hooksPath = ${HOOKS_PATH}`);
      expect(commitEmpty(linked, BAD_MESSAGE).status).not.toBe(0);
      expect(commitEmpty(main, BAD_MESSAGE).status).toBe(0);

      const mainLine = installIn(main);
      expect(mainLine).toBe(
        `hooks: on for this worktree (core.hooksPath=${HOOKS_PATH} in ${path.join(main, ".git", "config.worktree")})`,
      );
      expect(readText(main, ".git", "config")).toBe(sharedBefore);
      expect(readText(main, ".git", "config.worktree")).toContain(`hooksPath = ${HOOKS_PATH}`);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it(
    "the production git runner, built with no environment argument, installs in the throwaway repository while GIT_DIR points at a decoy",
    () => {
      const repo = initRepo("hooks-prod-runner");
      scaffold(repo, ["commit-msg"]);
      vi.stubEnv("HOME", initDir.dir);
      vi.stubEnv("XDG_CONFIG_HOME", initDir.dir);
      const lines: string[] = [];
      const deps: Deps = {
        env: {},
        git: gitRunner(repo),
        files: realFileOps(),
        log: (line) => {
          lines.push(line);
        },
        root: repo,
      };
      expect(process.env.GIT_DIR).toBeTruthy();
      expect(run(deps)).toBe(0);
      expect(lines[0]).toContain("hooks: on for this repository");
      expect(readText(repo, ".git", "config")).toContain(`hooksPath = ${HOOKS_PATH}`);
      expect(fs.existsSync(path.join(repo, ".husky", "_", "commit-msg"))).toBe(true);
    },
    REAL_GIT_TIMEOUT_MS,
  );

  it("a folder inside another repository gets no files and no config, and the line says why", () => {
    const outer = initRepo("hooks-outer");
    const inner = path.join(outer, "sub");
    fs.mkdirSync(inner);
    scaffold(inner, ["commit-msg"]);
    const before = readText(outer, ".git", "config");
    expect(installIn(inner)).toBe("hooks: skipped, this folder is not the top of its git work tree");
    expect(readText(outer, ".git", "config")).toBe(before);
    expect(fs.existsSync(path.join(inner, ".husky", "_"))).toBe(false);
  });

  it("the _ folder matches what stock husky writes for the same hooks: h, .gitignore and the wrappers, bytes and mode", () => {
    const hooks = ["pre-commit", "commit-msg"];
    const stock = initRepo("hooks-stock");
    scaffold(stock, hooks);
    const stockRun = spawnSync("node", ["-e", "import('husky').then(m => console.log(m.default()))"], {
      cwd: stock,
      encoding: "utf-8",
      env: hookEnv(),
    });
    expect(stockRun.status, stockRun.stderr).toBe(0);
    expect(stockRun.stdout.trim()).toBe("");

    const ours = initRepo("hooks-ours");
    scaffold(ours, hooks);
    installIn(ours);

    for (const name of ["h", ".gitignore", ...hooks]) {
      const stockFile = path.join(stock, ".husky", "_", name);
      const ourFile = path.join(ours, ".husky", "_", name);
      expect(fs.readFileSync(ourFile), name).toEqual(fs.readFileSync(stockFile));
      expect(fs.statSync(ourFile).mode & EXECUTABLE_BITS, name).toBe(fs.statSync(stockFile).mode & EXECUTABLE_BITS);
    }
  });
});
