import { GIT_BIN, SYMBOLIC_REF_ARGS } from "./migration-constants";

export const EXIT_OK = 0;
export const EXIT_FAIL = 1;

export const GH_ARGS: string[] = ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"];
export const GIT_ARGS: string[] = [...SYMBOLIC_REF_ARGS];
export const SAFE_BRANCH_PATTERN = /^[A-Za-z0-9._/][A-Za-z0-9._/-]*$/;
export const PARENT_SEGMENT = "..";
export const FIX_LINE =
  "cannot find the default branch: run `git remote set-head origin --auto` (or `gh auth login`), then try again";
export const unsafeLine = (name: string): string =>
  `the default branch name ${JSON.stringify(name)} holds characters a shell or a prompt must not carry: rename it to letters, digits, . _ - and /`;
export { GIT_BIN };
