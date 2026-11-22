import { Either } from "effect";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { withoutGitVariables } from "../lint/command";
import { CHILD_MAX_BUFFER_BYTES, EXIT_FAIL, EXIT_OK, GIT_BIN, TAIL_LINES } from "./shell-constants";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface Shell {
  cwd: string;
  run: (command: string, args: string[], cwd: string) => RunResult;
  read: (path: string) => string | undefined;
  write: (path: string, text: string) => void;
  tempDir: (prefix: string) => string;
  remove: (path: string) => void;
  out: (text: string) => void;
  err: (text: string) => void;
}

export const tail = (result: RunResult): string => `${result.stderr}${result.stdout}`.trim().split("\n").slice(-TAIL_LINES).join("\n");

export const step = (shell: Shell, command: string, args: string[], cwd: string): Either.Either<RunResult, string> => {
  const result = shell.run(command, args, cwd);
  return result.code === EXIT_OK ? Either.right(result) : Either.left(`\`${command} ${args.join(" ")}\` failed in ${cwd}:\n${tail(result)}`);
};

export const resolveCommit = (shell: Shell, ref: string): Either.Either<string, string> =>
  Either.map(step(shell, GIT_BIN, ["rev-parse", "--verify", `${ref}^{commit}`], shell.cwd), (result) => result.stdout.trim());

export const addWorktree = (shell: Shell, sha: string, prefix: string): Either.Either<string, string> => {
  const dir = shell.tempDir(prefix);
  return Either.map(step(shell, GIT_BIN, ["worktree", "add", "--detach", dir, sha], shell.cwd), () => dir);
};

export const removeWorktree = (shell: Shell, dir: string): void => {
  shell.run(GIT_BIN, ["worktree", "remove", "--force", dir], shell.cwd);
  shell.remove(dir);
};

export const childEnv = (extra: Record<string, string> = {}): Record<string, string | undefined> => ({ ...withoutGitVariables(process.env), ...extra });

export function realShell(extraEnv: Record<string, string> = {}): Shell {
  return {
    cwd: process.cwd(),
    run: (command, args, cwd) => {
      const result = spawnSync(command, args, { cwd, env: childEnv(extraEnv), encoding: "utf8", maxBuffer: CHILD_MAX_BUFFER_BYTES });
      if (result.error) return { code: EXIT_FAIL, stdout: "", stderr: result.error.message };
      return { code: result.status ?? EXIT_FAIL, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    },
    read: (path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined),
    write: (path, text) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    },
    tempDir: (prefix) => mkdtempSync(join(tmpdir(), prefix)),
    remove: (path) => rmSync(path, { recursive: true, force: true }),
    out: (text) => console.log(text),
    err: (text) => console.error(text),
  };
}
