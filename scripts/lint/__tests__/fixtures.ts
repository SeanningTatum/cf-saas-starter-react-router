import ts from "typescript";
import type { Baseline } from "../baseline";
import type { FileRule, Finding, Hit, RepoRule, RunResult, Source } from "../types";

export function badWordRule(overrides: Partial<FileRule> = {}): FileRule {
  return {
    id: "no-bad",
    scope: "file",
    matches: "The word BAD.",
    covers: "Every source file.",
    fix: "write GOOD",
    applies: () => true,
    check: ({ text }) =>
      text.split("\n").flatMap((line, index) => (line.includes("BAD") ? [{ line: index + 1, message: "BAD found" }] : [])),
    cases: [
      { name: "BAD is caught", files: { "app/a.ts": "const BAD = 1;" }, expect: "finding" },
      { name: "GOOD is clean", files: { "app/a.ts": "const GOOD = 1;" }, expect: "clean" },
    ],
    ...overrides,
  };
}

export function listedHitsRule(hits: Hit[], overrides: Partial<RepoRule> = {}): RepoRule {
  return {
    id: "repo-hits",
    scope: "repo",
    matches: "Whatever the test lists.",
    covers: "The whole repo.",
    fix: "remove the hit",
    check: () => hits,
    cases: [],
    ...overrides,
  };
}

export const finding = (rule: string, file: string, line = 1): Finding => ({
  rule,
  file,
  line,
  message: `${rule} hit`,
  fix: "fix it",
});

export const baseline = (overrides: Partial<Baseline> = {}): Baseline => ({
  suppressions: 0,
  boundaries: {},
  debt: {},
  ...overrides,
});

export const baselineText = (overrides: Partial<Baseline> = {}): string => JSON.stringify(baseline(overrides));

export const ran = (findings: Finding[], suppressions = 0): RunResult => ({ findings, suppressions, filesChecked: 0 });

export const sourceOf = (text: string, path = "app/a.ts"): Source => ({
  path,
  text,
  ast: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true),
});

export function recordedGit(outputs: Record<string, string>): { git: (args: string[]) => string | undefined; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    git: (args) => {
      const command = args.join(" ");
      calls.push(command);
      return outputs[command];
    },
  };
}
