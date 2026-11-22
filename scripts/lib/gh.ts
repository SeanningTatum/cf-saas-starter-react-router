import { spawnSync } from "node:child_process";

export interface GhResult {
  code: number;
  stdout: string;
  stderr: string;
}
/** Runs `gh <args>`, feeding `input` on stdin when given. Never throws. */
export type GhRunner = (args: string[], input?: string) => GhResult;

export const ghSpawn: GhRunner = (args, input) => {
  const r = spawnSync("gh", args, { input, encoding: "utf8" });
  if (r.error) return { code: 127, stdout: "", stderr: `cannot run gh: ${r.error.message}` };
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};
