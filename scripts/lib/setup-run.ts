import { spawnSync } from "node:child_process";
import { GH_MAX_BUFFER_BYTES } from "./gh";
import { REDACTED } from "./setup-constants";

export interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunOptions {
  readonly input?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export type Runner = (file: string, args: ReadonlyArray<string>, options?: RunOptions) => RunResult;

export const spawnRunner: Runner = (file, args, options) => {
  const result = spawnSync(file, [...args], {
    input: options?.input,
    encoding: "utf8",
    maxBuffer: GH_MAX_BUFFER_BYTES,
    env: options?.env ? { ...process.env, ...options.env } : process.env,
  });
  if (result.error) return { code: 127, stdout: "", stderr: `cannot run ${file}: ${result.error.message}` };
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

export const redact = (text: string, secrets: ReadonlyArray<string>): string =>
  secrets.filter((secret) => secret !== "").reduce((clean, secret) => clean.split(secret).join(REDACTED), text);

export const succeeded = (result: RunResult): boolean => result.code === 0;

export const failure = (result: RunResult, secrets: ReadonlyArray<string> = []): string =>
  redact((result.stderr || result.stdout).trim() || `exited with status ${result.code}`, secrets);

export const wrangler = (args: ReadonlyArray<string>): [string, ReadonlyArray<string>] => ["bunx", ["wrangler", ...args]];
