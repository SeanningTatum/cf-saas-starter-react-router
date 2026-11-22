#!/usr/bin/env bun
import { Either } from "effect";
import { spawnSync } from "node:child_process";
import {
  EXIT_FAIL,
  EXIT_OK,
  FIX_LINE,
  GH_ARGS,
  GIT_ARGS,
  GIT_BIN,
  PARENT_SEGMENT,
  SAFE_BRANCH_PATTERN,
  unsafeLine,
} from "./lib/default-branch-constants";
import { ghSpawn, type GhResult, type GhRunner } from "./lib/gh";
import { ORIGIN_PREFIX } from "./lib/migration-constants";

export interface Deps {
  gh: GhRunner;
  git: (args: string[]) => GhResult;
  out: (line: string) => void;
  err: (line: string) => void;
}

type Found = { kind: "none" } | { kind: "name"; name: string };

const NONE: Found = { kind: "none" };

export const isSafeBranch = (name: string): boolean =>
  SAFE_BRANCH_PATTERN.test(name) && !name.includes(PARENT_SEGMENT);

const answer = (result: GhResult, strip: (text: string) => string): Found => {
  if (result.code !== EXIT_OK) return NONE;
  const name = strip(result.stdout.trim());
  return name.length > 0 ? { kind: "name", name } : NONE;
};

const stripOrigin = (ref: string): string => (ref.startsWith(ORIGIN_PREFIX) ? ref.slice(ORIGIN_PREFIX.length) : ref);

export function defaultBranch(deps: Deps): Either.Either<string, string> {
  const fromGh = answer(deps.gh(GH_ARGS), (text) => text);
  const found = fromGh.kind === "name" ? fromGh : answer(deps.git(GIT_ARGS), stripOrigin);
  if (found.kind === "none") return Either.left(FIX_LINE);
  return isSafeBranch(found.name) ? Either.right(found.name) : Either.left(unsafeLine(found.name));
}

export function run(deps: Deps): number {
  return Either.match(defaultBranch(deps), {
    onLeft: (fix) => {
      deps.err(fix);
      return EXIT_FAIL;
    },
    onRight: (name) => {
      deps.out(name);
      return EXIT_OK;
    },
  });
}

export function realDeps(): Deps {
  return {
    gh: ghSpawn,
    git: (args) => {
      const result = spawnSync(GIT_BIN, args, { encoding: "utf8" });
      if (result.error) return { code: EXIT_FAIL, stdout: "", stderr: result.error.message };
      return { code: result.status ?? EXIT_FAIL, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    },
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  };
}

if (import.meta.main) {
  process.exit(run(realDeps()));
}
