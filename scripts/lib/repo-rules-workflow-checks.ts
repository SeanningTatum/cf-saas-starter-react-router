import { checkEntriesOf, type Ruleset } from "./repo-rules-schemas";

export function jobNames(yml: string): string[] {
  const names: string[] = [];
  let inJobs = false;
  for (const line of yml.split("\n")) {
    if (/^jobs:\s*$/.test(line)) inJobs = true;
    else if (/^[^\s#]/.test(line)) inJobs = false;
    const m = inJobs ? /^ {4}name:\s*(.+?)\s*$/.exec(line) : null;
    const name = m?.[1];
    if (name !== undefined) names.push(name.replace(/^(["'])(.*)\1$/, "$2"));
  }
  return names;
}

export function requiredContexts(rulesets: readonly Ruleset[]): string[] {
  const all = rulesets.flatMap((rs) =>
    rs.rules.flatMap((r) =>
      r.type === "required_status_checks" ? checkEntriesOf(r.parameters?.required_status_checks).map((c) => c.context) : [],
    ),
  );
  return [...new Set(all)].sort();
}
