#!/usr/bin/env bun
import { Either } from "effect";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  CI_FALSE_VALUES,
  EXECUTABLE_MODE,
  EXTENSION_ON_ANSWER,
  GIT_COMMAND,
  GIT_INSIDE_WORK_TREE,
  GIT_LOCAL_CONFIG_FILE,
  GIT_READ_LOCAL,
  GIT_READ_WORKTREE,
  GIT_WORKTREE_CONFIG_FILE,
  GIT_WORKTREE_EXTENSION,
  GIT_WRITE_LOCAL,
  GIT_WRITE_WORKTREE,
  HOOKS_DIR,
  HOOKS_PATH,
  HUSKY_OFF_VALUE,
  HUSKY_RUNTIME,
  IGNORE_CONTENT,
  IGNORE_FILE,
  INSIDE_WORK_TREE_ANSWER,
  RUNTIME_COPY_NAME,
  SCOPE_REPOSITORY_LABEL,
  SCOPE_WORKTREE_LABEL,
  SKIP_CI,
  SKIP_CONFIG_FAILED,
  SKIP_FILES_FAILED,
  SKIP_HUSKY_OFF,
  SKIP_NO_GIT,
  SKIP_NO_HUSKY,
  SKIP_NOT_WORK_TREE,
  WRAPPER_CONTENT,
  WRAPPER_DIR,
} from "./lib/install-hooks-constants";

export interface GitResult {
  status: number | null;
  stdout: string;
}

export type GitRunner = (args: readonly string[]) => GitResult;

export interface FileOps {
  exists: (file: string) => boolean;
  listFiles: (dir: string) => readonly string[];
  makeDir: (dir: string) => void;
  write: (file: string, content: string, mode?: number) => void;
  copy: (from: string, to: string) => void;
}

export interface Deps {
  env: Readonly<Record<string, string | undefined>>;
  git: GitRunner;
  files: FileOps;
  log: (line: string) => void;
  root: string;
}

export interface Scope {
  label: string;
  read: readonly string[];
  write: readonly string[];
  configFile: readonly string[];
}

export function ciIsOn(value: string | undefined): boolean {
  return value !== undefined && !CI_FALSE_VALUES.includes(value);
}

export function chooseScope(worktreeConfigOn: boolean): Scope {
  return worktreeConfigOn
    ? {
        label: SCOPE_WORKTREE_LABEL,
        read: GIT_READ_WORKTREE,
        write: GIT_WRITE_WORKTREE,
        configFile: GIT_WORKTREE_CONFIG_FILE,
      }
    : {
        label: SCOPE_REPOSITORY_LABEL,
        read: GIT_READ_LOCAL,
        write: GIT_WRITE_LOCAL,
        configFile: GIT_LOCAL_CONFIG_FILE,
      };
}

export function skipReason(deps: Deps): string | undefined {
  if (deps.env.HUSKY === HUSKY_OFF_VALUE) return SKIP_HUSKY_OFF;
  if (ciIsOn(deps.env.CI)) return SKIP_CI;
  const inside = deps.git(GIT_INSIDE_WORK_TREE);
  if (inside.status === null) return SKIP_NO_GIT;
  if (inside.status !== 0 || inside.stdout.trim() !== INSIDE_WORK_TREE_ANSWER) return SKIP_NOT_WORK_TREE;
  if (!deps.files.exists(path.join(deps.root, HUSKY_RUNTIME))) return SKIP_NO_HUSKY;
  return undefined;
}

export function writeHookFiles(deps: Deps): void {
  const hooksDir = path.join(deps.root, HOOKS_DIR);
  const wrapperDir = path.join(hooksDir, WRAPPER_DIR);
  deps.files.makeDir(wrapperDir);
  deps.files.write(path.join(wrapperDir, IGNORE_FILE), IGNORE_CONTENT);
  deps.files.copy(path.join(deps.root, HUSKY_RUNTIME), path.join(wrapperDir, RUNTIME_COPY_NAME));
  for (const hook of deps.files.listFiles(hooksDir)) {
    deps.files.write(path.join(wrapperDir, hook), WRAPPER_CONTENT, EXECUTABLE_MODE);
  }
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function install(deps: Deps): string {
  const written = Either.try({ try: () => writeHookFiles(deps), catch: errorText });
  if (Either.isLeft(written)) return `${SKIP_FILES_FAILED} (${written.left})`;

  const scope = chooseScope(deps.git(GIT_WORKTREE_EXTENSION).stdout.trim() === EXTENSION_ON_ANSWER);
  const configFile = path.resolve(deps.root, deps.git(scope.configFile).stdout.trim());
  const where = `core.hooksPath=${HOOKS_PATH} in ${configFile}`;

  const current = deps.git(scope.read);
  if (current.status === 0 && current.stdout.trim() === HOOKS_PATH) {
    return `hooks: already on for ${scope.label} (${where})`;
  }
  if (deps.git(scope.write).status !== 0) return SKIP_CONFIG_FAILED;
  return `hooks: on for ${scope.label} (${where})`;
}

export function run(deps: Deps): number {
  deps.log(skipReason(deps) ?? install(deps));
  return 0;
}

export function gitRunner(root: string, env?: NodeJS.ProcessEnv): GitRunner {
  return (args) => {
    const result = spawnSync(GIT_COMMAND, [...args], {
      cwd: root,
      encoding: "utf-8",
      ...(env ? { env } : {}),
    });
    return { status: result.error ? null : result.status, stdout: result.stdout ?? "" };
  };
}

export function realFileOps(): FileOps {
  return {
    exists: (file) => fs.existsSync(file),
    listFiles: (dir) =>
      fs.existsSync(dir)
        ? fs
            .readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name)
        : [],
    makeDir: (dir) => {
      fs.mkdirSync(dir, { recursive: true });
    },
    write: (file, content, mode) => {
      fs.writeFileSync(file, content);
      if (mode !== undefined) fs.chmodSync(file, mode);
    },
    copy: (from, to) => {
      fs.copyFileSync(from, to);
    },
  };
}

export function realDeps(): Deps {
  const root = path.resolve(import.meta.dirname, "..");
  return {
    env: Bun.env,
    git: gitRunner(root),
    files: realFileOps(),
    log: (line) => console.log(line),
    root,
  };
}

if (import.meta.main) {
  process.exit(run(realDeps()));
}
