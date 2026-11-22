import { spawnSync } from "node:child_process";

export type Environment = Record<string, string | undefined>;

export interface CommandOptions {
  cwd: string;
  env: Environment;
  timeout?: number;
}

const GIT_VARIABLE = /^GIT_/;

export function withoutGitVariables(env: Environment): Environment {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !GIT_VARIABLE.test(name)));
}

export function runCommand(command: string, args: string[], options: CommandOptions): string | undefined {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: withoutGitVariables(options.env),
    encoding: "utf8",
    timeout: options.timeout,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? result.stdout.trim() : undefined;
}
