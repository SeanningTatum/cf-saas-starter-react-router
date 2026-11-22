import type ts from "typescript";

export interface Source {
  path: string;
  text: string;
  ast: ts.SourceFile;
}

export interface Repo {
  files(dir: string): string[];
  read(path: string): string | undefined;
  source(path: string): Source | undefined;
}

export interface Hit {
  file: string;
  line: number;
  message: string;
  fix?: string;
}

export type FileHit = Omit<Hit, "file">;

export interface Case {
  name: string;
  files: Record<string, string>;
  expect: "finding" | "clean";
}

interface RuleBase {
  id: string;
  nonNegotiable?: number;
  matches: string;
  covers: string;
  fix: string;
  example?: string;
  cases: Case[];
}

export interface FileRule extends RuleBase {
  scope: "file";
  applies(path: string): boolean;
  suppressionMarker?: string;
  check(source: Source, repo: Repo): FileHit[];
}

export interface RepoRule extends RuleBase {
  scope: "repo";
  check(repo: Repo): Hit[];
}

export type Rule = FileRule | RepoRule;

export interface Finding {
  rule: string;
  file: string;
  line: number;
  message: string;
  fix: string;
  example?: string;
}

export interface RunResult {
  findings: Finding[];
  suppressions: number;
  filesChecked: number;
}

export interface Outcome {
  code: number;
  stdout: string[];
  stderr: string[];
}
