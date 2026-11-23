#!/usr/bin/env bun
import { Either } from "effect";
import { spawnSync } from "node:child_process";
import { CHILD_MAX_BUFFER_BYTES, EXIT_FAIL, EXIT_OK, GIT_BIN } from "../lib/shell-constants";
import { checkBody } from "../lib/size-report";

export interface Deps {
  env: Record<string, string | undefined>;
  diff: (base: string, head: string) => { code: number; stdout: string };
  log: (line: string) => void;
}

export function run(deps: Deps): number {
  const base = deps.env.BASE_SHA ?? "";
  const head = deps.env.HEAD_SHA ?? "";
  const diff = deps.diff(base, head);
  if (!base || !head || diff.code !== EXIT_OK) {
    deps.log(`::error::cannot list the files this PR changes (git diff ${base}...${head}); the checkout needs fetch-depth: 0`);
    return EXIT_FAIL;
  }
  const paths = diff.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return Either.match(checkBody(deps.env.PR_BODY ?? "", paths), {
    onLeft: (message) => {
      deps.log(`::error::${message}`);
      return EXIT_FAIL;
    },
    onRight: (message) => {
      deps.log(message);
      return EXIT_OK;
    },
  });
}

if (import.meta.main) {
  process.exit(
    run({
      env: process.env,
      diff: (base, head) => {
        const result = spawnSync(GIT_BIN, ["diff", "--name-only", `${base}...${head}`], { encoding: "utf8", maxBuffer: CHILD_MAX_BUFFER_BYTES });
        return { code: result.status ?? EXIT_FAIL, stdout: result.stdout ?? "" };
      },
      log: (line) => console.log(line),
    }),
  );
}
