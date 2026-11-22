import { commentsIn } from "./comments";
import type { FileHit, FileRule, Finding, Hit, Repo, Rule, RunResult, Source } from "./types";

interface Marker {
  line: number;
  endLine: number;
  reason: string;
}

interface Suppressed {
  hits: FileHit[];
  count: number;
}

function markers(source: Source, marker: string): Marker[] {
  return commentsIn(source).flatMap((comment) =>
    comment.body.startsWith(marker)
      ? [{ line: comment.line, endLine: comment.endLine, reason: comment.body.slice(marker.length).trim() }]
      : []
  );
}

export function applySuppression(rule: FileRule, source: Source, hits: FileHit[]): Suppressed {
  const marker = rule.suppressionMarker;
  if (!marker) return { hits, count: 0 };
  const found = markers(source, marker);
  const withReason = found.filter((entry) => entry.reason !== "");
  const excusedBy = (hit: FileHit): Marker | undefined =>
    withReason.find((entry) => hit.line >= entry.line && hit.line <= entry.endLine + 1);
  const used = new Set(hits.flatMap((hit) => excusedBy(hit) ?? []));
  const kept = hits.filter((hit) => !excusedBy(hit));
  const noReason = found
    .filter((entry) => entry.reason === "")
    .map((entry) => ({
      line: entry.line,
      message: `\`${marker}\` has no reason, so it excuses nothing`,
      fix: `write the reason after the colon, \`// ${marker} <why>\`, or delete the comment and fix the code under it`,
    }));
  const unused = withReason
    .filter((entry) => !used.has(entry))
    .map((entry) => ({
      line: entry.line,
      message: `\`${marker}\` excuses nothing on its own lines or the line after`,
      fix: "delete the comment, or move it to the line right above the call it excuses",
    }));
  return { hits: [...kept, ...noReason, ...unused], count: withReason.length };
}

const toFinding = (rule: Rule, hit: Hit): Finding => ({
  rule: rule.id,
  file: hit.file,
  line: hit.line,
  message: hit.message,
  fix: hit.fix ?? rule.fix,
  example: hit.example ?? rule.example,
});

const byText = (a: string, b: string): number => Number(a > b) - Number(a < b);

const byPlace = (a: Finding, b: Finding): number => byText(a.file, b.file) || a.line - b.line || byText(a.rule, b.rule);

export function runRules(rules: Rule[], repo: Repo, roots: readonly string[], only?: ReadonlySet<string>): RunResult {
  const paths = (only ? [...only] : roots.flatMap((root) => repo.files(root))).sort();
  const findings: Finding[] = [];
  let suppressions = 0;
  let filesChecked = 0;
  for (const path of paths) {
    const applicable = rules.filter((rule): rule is FileRule => rule.scope === "file" && rule.applies(path));
    const source = applicable.length > 0 ? repo.source(path) : undefined;
    if (!source) continue;
    filesChecked += 1;
    for (const rule of applicable) {
      const { hits, count } = applySuppression(rule, source, rule.check(source, repo));
      suppressions += count;
      findings.push(...hits.map((hit) => toFinding(rule, { ...hit, file: path })));
    }
  }
  for (const rule of rules) {
    if (rule.scope !== "repo") continue;
    const hits = rule.check(repo, only).filter((hit) => !only || [hit.file, ...(hit.related ?? [])].some((path) => only.has(path)));
    findings.push(...hits.map((hit) => toFinding(rule, hit)));
  }
  return { findings: findings.sort(byPlace), suppressions, filesChecked };
}
