import { FINDING_LINE, FIX_LEAD, LINT_ROOTS, RULE_ID } from "./constants";
import { formatFinding } from "./format";
import { memoryRepo } from "./repo";
import { runRules } from "./run";
import type { Case, Rule } from "./types";

export interface SelftestResult {
  rules: number;
  cases: number;
  failures: string[];
}

function shapeFailures(rule: Rule, exists: (path: string) => boolean): string[] {
  const failures: string[] = [];
  if (!RULE_ID.test(rule.id)) failures.push("the id must be kebab-case, like `no-throw`");
  if (rule.matches.trim() === "") failures.push("`matches` is empty: say what the rule matches");
  if (rule.covers.trim() === "") failures.push("`covers` is empty: say which files the rule reads");
  if (rule.fix.trim() === "") failures.push("`fix` is empty: say what to write instead");
  if (rule.fix.includes(FIX_LEAD)) failures.push(`\`fix\` must not repeat "${FIX_LEAD}"; the runner adds it`);
  if (rule.example !== undefined && !exists(rule.example)) failures.push(`\`example\` names ${rule.example}, which does not exist`);
  for (const expect of ["finding", "clean"] as const) {
    if (!rule.cases.some((testCase) => testCase.expect === expect)) failures.push(`no case expects "${expect}"`);
  }
  return failures;
}

function caseFailure(rule: Rule, testCase: Case): string | undefined {
  const lines = runRules([rule], memoryRepo(testCase.files), LINT_ROOTS).findings.map(formatFinding);
  if (testCase.expect === "clean") {
    return lines.length === 0 ? undefined : `case "${testCase.name}" expected no finding, got: ${lines.join(" | ")}`;
  }
  if (lines.length === 0) return `case "${testCase.name}" expected a finding, got none`;
  const malformed = lines.find((line) => !FINDING_LINE.test(line));
  return malformed ? `case "${testCase.name}" printed a line outside the house shape: ${malformed}` : undefined;
}

export function selftest(rules: Rule[], exists: (path: string) => boolean): SelftestResult {
  const failures: string[] = [];
  const seen = new Set<string>();
  let cases = 0;
  for (const rule of rules) {
    const problems = shapeFailures(rule, exists);
    if (seen.has(rule.id)) problems.push("another rule has the same id");
    seen.add(rule.id);
    for (const testCase of rule.cases) {
      cases += 1;
      const failure = caseFailure(rule, testCase);
      if (failure) problems.push(failure);
    }
    failures.push(...problems.map((problem) => `${rule.id}: ${problem}`));
  }
  return { rules: rules.length, cases, failures };
}
