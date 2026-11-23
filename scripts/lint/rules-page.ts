import { BASELINE_CHECKS } from "./baseline";
import { RULES_END, RULES_PAGE, RULES_START, WRITE_DOCS_COMMAND } from "./constants";
import type { Rule } from "./types";

const cell = (text: string): string =>
  text
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\s*\n\s*/g, " ")
    .trim();

const row = (cells: string[]): string => `| ${cells.map(cell).join(" | ")} |`;

export function renderRules(rules: Rule[]): string {
  const ruleRows = rules.map((rule) =>
    row([
      `\`${rule.id}\``,
      rule.nonNegotiable === undefined ? "" : String(rule.nonNegotiable),
      rule.matches,
      rule.covers,
      rule.fix,
      rule.example ? `\`${rule.example}\`` : "",
    ]),
  );
  const checkRows = Object.values(BASELINE_CHECKS).map((check) => row([`\`${check.id}\``, check.matches, check.fix]));
  return [
    "| Rule | Non-negotiable | What it matches | Files it reads | Do this instead | Example |",
    "|------|----------------|-----------------|----------------|-----------------|---------|",
    ...ruleRows,
    "",
    "Checks on the baseline file itself:",
    "",
    "| Check | What it matches | Do this instead |",
    "|-------|-----------------|-----------------|",
    ...checkRows,
  ].join("\n");
}

export function applyRules(page: string, table: string): string | undefined {
  const start = page.indexOf(RULES_START);
  const end = page.indexOf(RULES_END);
  if (start < 0 || end < start) return undefined;
  return `${page.slice(0, start + RULES_START.length)}\n${table}\n${page.slice(end)}`;
}

export type PageCheck = { fresh: true } | { fresh: false; problem: string };

export function checkPage(page: string | undefined, table: string): PageCheck {
  if (page === undefined)
    return {
      fresh: false,
      problem: `${RULES_PAGE} is missing. Create it with the two markers ${RULES_START} and ${RULES_END}, then run \`${WRITE_DOCS_COMMAND}\`.`,
    };
  const next = applyRules(page, table);
  if (next === undefined)
    return { fresh: false, problem: `${RULES_PAGE} has no ${RULES_START} … ${RULES_END} block. Add the two markers, then run \`${WRITE_DOCS_COMMAND}\`.` };
  if (next !== page)
    return { fresh: false, problem: `${RULES_PAGE} is stale: the table differs from the rules in scripts/lint/rules/. Run \`${WRITE_DOCS_COMMAND}\`.` };
  return { fresh: true };
}
