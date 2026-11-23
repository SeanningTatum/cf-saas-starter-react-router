#!/usr/bin/env bun
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBase, type Base, type BaseDeps } from "./lint/base-ref";
import { runCommand } from "./lint/command";
import { GH_TIMEOUT_MS, SHORT_SHA_LENGTH } from "./lint/constants";
import { diskRepo } from "./lint/repo";
import type { Repo } from "./lint/types";
import { planChanged, renderPlan } from "./lib/verify-plan";
import { EXIT_OK, EXIT_USAGE, FIELD, GIT_DIFF, GIT_UNTRACKED, LINE, NO_BASE_REASON, NUL, USAGE } from "./lib/verify-plan-constants";

export interface Deps extends BaseDeps {
  repo: Repo;
  out(line: string): void;
  err(line: string): void;
}

export function baseFor(deps: Deps, named: string | undefined): Base {
  if (named === undefined) return resolveBase(deps);
  const sha = deps.git(["merge-base", "HEAD", named]);
  return sha ? { found: true, sha, from: named } : { found: false, required: true, tried: [named] };
}

const paths = (text: string | undefined): string[] => (text ?? "").split(NUL).filter((path) => path.length > 0);

export function changedPaths(deps: Deps, sha: string): string[] | undefined {
  const diff = deps.git([...GIT_DIFF, sha]);
  if (diff === undefined) return undefined;
  return [...new Set([...paths(diff), ...paths(deps.git([...GIT_UNTRACKED]))])].sort();
}

export function run(argv: string[], deps: Deps): number {
  const [named, ...rest] = argv;
  if (rest.length > 0 || named?.startsWith("-")) {
    deps.err(USAGE);
    return EXIT_USAGE;
  }
  const base = baseFor(deps, named);
  if (!base.found) {
    if (named !== undefined) {
      deps.err(`verify --changed: ${named} has no merge base with HEAD. Name a branch or commit this one grew from.`);
      return EXIT_USAGE;
    }
    deps.out([LINE.full, `${NO_BASE_REASON} (tried: ${base.tried.join(", ") || "none named"})`].join(FIELD));
    return EXIT_OK;
  }
  deps.out([LINE.base, `${base.sha.slice(0, SHORT_SHA_LENGTH)} (${base.from})`].join(FIELD));
  const changed = changedPaths(deps, base.sha);
  if (changed === undefined) {
    deps.out([LINE.full, `git diff against ${base.from} failed`].join(FIELD));
    return EXIT_OK;
  }
  for (const line of renderPlan(planChanged(deps.repo, changed))) deps.out(line);
  return EXIT_OK;
}

if (import.meta.main) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const git = (args: string[]) => runCommand("git", args, { cwd: root, env: process.env });
  const code = run(process.argv.slice(2), {
    repo: diskRepo(root),
    env: process.env,
    git,
    pullRequestTarget: () =>
      runCommand("gh", ["pr", "view", "--json", "baseRefName", "--jq", ".baseRefName"], { cwd: root, env: process.env, timeout: GH_TIMEOUT_MS }) || undefined,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  });
  process.exit(code);
}
