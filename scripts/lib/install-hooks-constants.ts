export const GIT_COMMAND = "git";
export const HOOKS_DIR = ".husky";
export const WRAPPER_DIR = "_";
export const HOOKS_PATH = ".husky/_";
export const HUSKY_RUNTIME = "node_modules/husky/husky";
export const RUNTIME_COPY_NAME = "h";
export const IGNORE_FILE = ".gitignore";
export const IGNORE_CONTENT = "*";
export const WRAPPER_CONTENT = '#!/usr/bin/env sh\n. "$(dirname "$0")/h"';
export const EXECUTABLE_MODE = 0o755;

export const HUSKY_OFF_VALUE = "0";
export const CI_FALSE_VALUES: readonly string[] = ["", "0", "false"];
export const INSIDE_WORK_TREE_ANSWER = "true";
export const EXTENSION_ON_ANSWER = "true";

export const GIT_INSIDE_WORK_TREE: readonly string[] = ["rev-parse", "--is-inside-work-tree"];
export const GIT_WORKTREE_EXTENSION: readonly string[] = [
  "config",
  "--type=bool",
  "--get",
  "extensions.worktreeConfig",
];
export const GIT_READ_WORKTREE: readonly string[] = ["config", "--worktree", "--get", "core.hooksPath"];
export const GIT_READ_LOCAL: readonly string[] = ["config", "--local", "--get", "core.hooksPath"];
export const GIT_WRITE_WORKTREE: readonly string[] = ["config", "--worktree", "core.hooksPath", HOOKS_PATH];
export const GIT_WRITE_LOCAL: readonly string[] = ["config", "core.hooksPath", HOOKS_PATH];
export const GIT_WORKTREE_CONFIG_FILE: readonly string[] = ["rev-parse", "--git-path", "config.worktree"];
export const GIT_LOCAL_CONFIG_FILE: readonly string[] = ["rev-parse", "--git-path", "config"];

export const SKIP_HUSKY_OFF = "hooks: skipped, HUSKY=0";
export const SKIP_CI = "hooks: skipped, CI";
export const SKIP_NO_GIT = "hooks: skipped, git is not installed";
export const SKIP_NOT_WORK_TREE = "hooks: skipped, not inside a git work tree";
export const SKIP_NO_HUSKY = "hooks: skipped, husky is not installed";
export const SKIP_FILES_FAILED = "hooks: skipped, could not write .husky/_";
export const SKIP_CONFIG_FAILED = "hooks: skipped, git config refused core.hooksPath";

export const SCOPE_WORKTREE_LABEL = "this worktree";
export const SCOPE_REPOSITORY_LABEL = "this repository";
