import { afterEach, beforeEach, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const GIT_IDENTITY = [
  "-c",
  "user.name=Test",
  "-c",
  "user.email=test@example.invalid",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "tag.gpgsign=false",
];

const GIT_ENV_PREFIX = "GIT_";
export const NO_GLOBAL_CONFIG = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

export const envOutsideAnyHook = (source: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(Object.entries(source).filter(([key]) => !key.startsWith(GIT_ENV_PREFIX))),
  ...NO_GLOBAL_CONFIG,
});

export interface GitSandbox {
  repos: string[];
  hookDecoy: { dir: string };
  makeDir: (prefix: string) => string;
}

export const useGitSandbox = (decoyPrefix: string): GitSandbox => {
  const repos: string[] = [];
  const hookDecoy = { dir: "" };

  beforeEach(() => {
    hookDecoy.dir = fs.mkdtempSync(path.join(os.tmpdir(), `${decoyPrefix}-decoy-`));
    vi.stubEnv("GIT_DIR", hookDecoy.dir);
    vi.stubEnv("GIT_WORK_TREE", path.join(hookDecoy.dir, "work"));
    vi.stubEnv("GIT_INDEX_FILE", path.join(hookDecoy.dir, "index"));
  });

  afterEach(() => {
    const leftInDecoy = fs.readdirSync(hookDecoy.dir);
    vi.unstubAllEnvs();
    for (const dir of [...repos.splice(0), hookDecoy.dir]) fs.rmSync(dir, { recursive: true, force: true });
    expect(leftInDecoy, "a child git process wrote where the hook's GIT_DIR pointed").toEqual([]);
  });

  const makeDir = (prefix: string): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`)));
    repos.push(dir);
    return dir;
  };

  return { repos, hookDecoy, makeDir };
};
