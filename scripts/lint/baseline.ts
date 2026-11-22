import { Either, Schema } from "effect";
import { BASELINE_PATH, LOWER_BASELINE_COMMAND } from "./constants";
import type { Finding, RunResult } from "./types";

const PerRule = <A>(value: Schema.Schema<A>) =>
  Schema.Record({ key: Schema.String, value: Schema.Record({ key: Schema.String, value }) });

const BaselineFile = Schema.parseJson(
  Schema.Struct({
    suppressions: Schema.Int.pipe(Schema.nonNegative()),
    boundaries: PerRule(Schema.NonEmptyTrimmedString),
    debt: PerRule(Schema.Int.pipe(Schema.positive())),
  })
);

export type Baseline = typeof BaselineFile.Type;

export const BASELINE_CHECKS = {
  grew: {
    id: "baseline-grew",
    matches: "An entry, a count or the suppression total in the baseline is higher than on the branch this one merges into.",
    fix: "fix the code the entry excuses and take the entry back out; a baseline only shrinks",
  },
  stale: {
    id: "baseline-stale",
    matches: "A baseline entry excuses more than the code now holds: the file is clean, gone, or has fewer findings than the count.",
    fix: `run \`${LOWER_BASELINE_COMMAND}\`, which lowers each count to what the linter finds and deletes an entry when it finds nothing`,
  },
  shape: {
    id: "baseline-shape",
    matches: "The baseline cannot be read, names a rule that does not exist, or has no `debt` key for a rule that does.",
    fix: 'keep `suppressions`, `boundaries` and `debt` in the file, with one `"<rule-id>": {}` key under `debt` for every rule',
  },
  base: {
    id: "baseline-base",
    matches: "The baseline to compare with cannot be read: in CI the base branch is missing, or the base holds the linter with no baseline, or its baseline does not parse.",
    fix: "set `fetch-depth: 0` on the checkout step of the job that runs this gate, so git has the base branch",
  },
} as const;

type Check = (typeof BASELINE_CHECKS)[keyof typeof BASELINE_CHECKS];

export const baselineFinding = (check: Check, message: string, fix: string = check.fix): Finding => ({
  rule: check.id,
  file: BASELINE_PATH,
  line: 1,
  message,
  fix,
});

export function parseBaseline(text: string): Either.Either<Baseline, Finding> {
  return Either.mapLeft(Schema.decodeUnknownEither(BaselineFile, { onExcessProperty: "error" })(text), (error) =>
    baselineFinding(BASELINE_CHECKS.shape, `the baseline does not parse: ${error.message.split("\n").join(" ")}`)
  );
}

const entries = <A>(perRule: Record<string, Record<string, A>>): Array<[rule: string, file: string, value: A]> =>
  Object.entries(perRule).flatMap(([rule, files]) =>
    Object.entries(files).map(([file, value]): [string, string, A] => [rule, file, value])
  );

const key = (rule: string, file: string): string => `${rule}\n${file}`;

function weighByRuleAndFile(run: RunResult): Map<string, number> {
  const counts = new Map<string, number>();
  for (const found of run.findings) {
    const place = key(found.rule, found.file);
    counts.set(place, (counts.get(place) ?? 0) + Math.max(1, Math.ceil(found.weight ?? 1)));
  }
  return counts;
}

function ruleKeyFindings(baseline: Baseline, ruleIds: readonly string[]): Finding[] {
  const known = new Set(ruleIds);
  const listed = new Set([...Object.keys(baseline.debt), ...Object.keys(baseline.boundaries)]);
  const unknown = [...listed]
    .filter((rule) => !known.has(rule))
    .map((rule) =>
      baselineFinding(BASELINE_CHECKS.shape, `the baseline lists the rule "${rule}", and no rule has that id`, `delete the "${rule}" key`)
    );
  const missing = ruleIds
    .filter((rule) => !(rule in baseline.debt))
    .map((rule) =>
      baselineFinding(BASELINE_CHECKS.shape, `the rule "${rule}" has no key under \`debt\``, `add \`"${rule}": {}\` under \`debt\``)
    );
  return [...unknown, ...missing];
}

export function applyBaseline(
  baseline: Baseline,
  run: RunResult,
  ruleIds: readonly string[],
  only?: ReadonlySet<string>
): Finding[] {
  const counts = weighByRuleAndFile(run);
  const inScope = (file: string): boolean => !only || only.has(file);

  const kept = run.findings.flatMap((found): Finding[] => {
    if (baseline.boundaries[found.rule]?.[found.file]) return [];
    const allowed = baseline.debt[found.rule]?.[found.file] ?? 0;
    const count = counts.get(key(found.rule, found.file)) ?? 0;
    if (count <= allowed) return [];
    return allowed === 0 ? [found] : [{ ...found, message: `${found.message} (this file counts ${count}, the baseline allows ${allowed})` }];
  });

  const staleDebt = entries(baseline.debt)
    .filter(([, file]) => inScope(file))
    .flatMap(([rule, file, allowed]) => {
      const count = counts.get(key(rule, file)) ?? 0;
      if (count >= allowed) return [];
      const byHand = count === 0 ? `delete "${file}" from \`debt["${rule}"]\`` : `set \`debt["${rule}"]["${file}"]\` to ${count}`;
      const fix = `run \`${LOWER_BASELINE_COMMAND}\`, or by hand ${byHand}`;
      return [baselineFinding(BASELINE_CHECKS.stale, `debt["${rule}"]["${file}"] is ${allowed}, and the linter finds ${count}`, fix)];
    });

  const staleBoundaries = entries(baseline.boundaries)
    .filter(([rule, file]) => inScope(file) && !counts.has(key(rule, file)))
    .map(([rule, file]) =>
      baselineFinding(
        BASELINE_CHECKS.stale,
        `boundaries["${rule}"]["${file}"] excuses a file where the rule finds nothing`,
        `run \`${LOWER_BASELINE_COMMAND}\`, or by hand delete "${file}" from \`boundaries["${rule}"]\``
      )
    );

  if (only) return [...kept, ...staleDebt, ...staleBoundaries];
  return [
    ...kept,
    ...staleDebt,
    ...staleBoundaries,
    ...suppressionFindings(baseline.suppressions, run.suppressions),
    ...ruleKeyFindings(baseline, ruleIds),
  ];
}

function suppressionFindings(allowed: number, held: number): Finding[] {
  if (held > allowed) {
    return [
      baselineFinding(
        BASELINE_CHECKS.grew,
        `the code holds ${held} suppression comment(s), and the baseline allows ${allowed}`,
        "delete the new suppression comment and fix the code under it"
      ),
    ];
  }
  if (held < allowed) {
    return [
      baselineFinding(
        BASELINE_CHECKS.stale,
        `\`suppressions\` is ${allowed}, and the code holds ${held}`,
        `run \`${LOWER_BASELINE_COMMAND}\`, or by hand set \`suppressions\` to ${held}`
      ),
    ];
  }
  return [];
}

export function compareWithBase(base: Baseline, head: Baseline): Finding[] {
  const isNewRule = (rule: string): boolean => !(rule in base.debt);
  const grewDebt = entries(head.debt)
    .filter(([rule, file, count]) => !isNewRule(rule) && count > (base.debt[rule]?.[file] ?? 0))
    .map(([rule, file, count]) =>
      baselineFinding(
        BASELINE_CHECKS.grew,
        `debt["${rule}"]["${file}"] is ${count}, and the branch this merges into has ${base.debt[rule]?.[file] ?? 0}`,
        `fix the new "${rule}" finding in ${file} and put the count back; run \`bun run lint:house ${file}\` to see it`
      )
    );
  const grewBoundaries = entries(head.boundaries)
    .filter(([rule, file]) => !isNewRule(rule) && !base.boundaries[rule]?.[file])
    .map(([rule, file]) =>
      baselineFinding(
        BASELINE_CHECKS.grew,
        `boundaries["${rule}"]["${file}"] is new on this branch`,
        `take the entry back out and make ${file} pass "${rule}"; a new boundary is the owner's call, in its own pull request`
      )
    );
  const grewSuppressions =
    head.suppressions > base.suppressions
      ? [
          baselineFinding(
            BASELINE_CHECKS.grew,
            `\`suppressions\` is ${head.suppressions}, and the branch this merges into has ${base.suppressions}`,
            "delete the new suppression comment, fix the code under it, and put the total back"
          ),
        ]
      : [];
  return [...grewDebt, ...grewBoundaries, ...grewSuppressions];
}

export function lowerBaseline(baseline: Baseline, run: RunResult): Baseline {
  const counts = weighByRuleAndFile(run);
  const debt = Object.fromEntries(
    Object.entries(baseline.debt).map(([rule, files]) => [
      rule,
      Object.fromEntries(
        Object.entries(files).flatMap(([file, allowed]): Array<[string, number]> => {
          const count = Math.min(allowed, counts.get(key(rule, file)) ?? 0);
          return count > 0 ? [[file, count]] : [];
        })
      ),
    ])
  );
  const boundaries = Object.fromEntries(
    Object.entries(baseline.boundaries).map(([rule, files]) => [
      rule,
      Object.fromEntries(Object.entries(files).filter(([file]) => counts.has(key(rule, file)))),
    ])
  );
  return { suppressions: Math.min(baseline.suppressions, run.suppressions), boundaries, debt };
}

export const baselineSize = (baseline: Baseline): { entries: number; debt: number; boundaries: number } => ({
  entries: entries(baseline.debt).length,
  debt: entries(baseline.debt).reduce((total, [, , count]) => total + count, 0),
  boundaries: entries(baseline.boundaries).length,
});
