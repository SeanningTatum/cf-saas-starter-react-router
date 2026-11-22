import { Either, Schema } from "effect";
import { ARROW, CLS_AUDIT, LCP_AUDIT, LIMITS_FILE, METRIC_KEYS as KEYS, NO_BREACH, NUMBER_LOCALE, SCORE_AUDIT, TBT_AUDIT, heading } from "./lighthouse-constants";

const Audit = Schema.Struct({ numericValue: Schema.Number });

const LhrSchema = Schema.Struct({
  categories: Schema.Struct({ [SCORE_AUDIT]: Schema.Struct({ score: Schema.Number }) }),
  audits: Schema.Struct({ [LCP_AUDIT]: Audit, [TBT_AUDIT]: Audit, [CLS_AUDIT]: Audit }),
});

const MetricsSchema = Schema.Struct({ score: Schema.Number, lcp: Schema.Number, tbt: Schema.Number, cls: Schema.Number });

const LimitsSchema = Schema.Struct({ minScore: Schema.Number, maxLcpMs: Schema.Number, maxTbtMs: Schema.Number, maxCls: Schema.Number });

const PageSchema = Schema.Struct({ page: Schema.String, runs: Schema.Array(MetricsSchema), median: MetricsSchema, spread: MetricsSchema });
const RefSchema = Schema.Struct({ ref: Schema.String, pages: Schema.Array(PageSchema) });

export type Metrics = typeof MetricsSchema.Type;
export type Limits = typeof LimitsSchema.Type;
export type PageResult = typeof PageSchema.Type;
export type RefResult = typeof RefSchema.Type;

const firstLine = (error: Error): string => error.message.split("\n")[0] ?? "";

export const metricsOf = (text: string): Either.Either<Metrics, string> =>
  Either.mapLeft(
    Either.map(Schema.decodeUnknownEither(Schema.parseJson(LhrSchema))(text), (lhr) => ({
      score: Math.round(lhr.categories[SCORE_AUDIT].score * 100),
      lcp: lhr.audits[LCP_AUDIT].numericValue,
      tbt: lhr.audits[TBT_AUDIT].numericValue,
      cls: lhr.audits[CLS_AUDIT].numericValue,
    })),
    (error) => `cannot read the Lighthouse report: ${firstLine(error)}`,
  );

export const parseLimits = (text: string): Either.Either<Limits, string> =>
  Either.mapLeft(Schema.decodeUnknownEither(Schema.parseJson(LimitsSchema))(text), (error) => `cannot read ${LIMITS_FILE}: ${firstLine(error)}`);

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return Number.NaN;
  return sorted.length % 2 === 1 ? (sorted[middle] ?? Number.NaN) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

const spreadOf = (values: number[]): number => (values.length === 0 ? 0 : Math.max(...values) - Math.min(...values));

const perMetric = (runs: Metrics[], pick: (values: number[]) => number): Metrics =>
  Object.fromEntries(KEYS.map((key) => [key, pick(runs.map((run) => run[key]))])) as unknown as Metrics;

export const summarize = (page: string, runs: Metrics[]): PageResult => ({
  page,
  runs,
  median: perMetric(runs, median),
  spread: perMetric(runs, spreadOf),
});

export const widestSpread = (pages: readonly PageResult[]): Metrics =>
  perMetric(pages.map((page) => page.spread), (values) => (values.length === 0 ? 0 : Math.max(...values)));

const ms = (value: number): string => `${Math.round(value).toLocaleString(NUMBER_LOCALE)} ms`;
const cls = (value: number): string => value.toFixed(3);
const FORMAT: Record<(typeof KEYS)[number], (value: number) => string> = { score: String, lcp: ms, tbt: ms, cls };

const pair = (key: (typeof KEYS)[number], base: Metrics | undefined, head: Metrics): string =>
  base === undefined ? FORMAT[key](head[key]) : `${FORMAT[key](base[key])}${ARROW}${FORMAT[key](head[key])}`;

export function breaches(head: RefResult, limits: Limits): string[] {
  return head.pages.flatMap(({ page, median: m }) => [
    ...(m.score < limits.minScore ? [`\`${page}\` performance score ${m.score} is below ${limits.minScore}`] : []),
    ...(m.lcp > limits.maxLcpMs ? [`\`${page}\` LCP ${ms(m.lcp)} is above ${ms(limits.maxLcpMs)}`] : []),
    ...(m.tbt > limits.maxTbtMs ? [`\`${page}\` TBT ${ms(m.tbt)} is above ${ms(limits.maxTbtMs)}`] : []),
    ...(m.cls > limits.maxCls ? [`\`${page}\` CLS ${cls(m.cls)} is above ${cls(limits.maxCls)}`] : []),
  ]);
}

export function renderLighthouse(head: RefResult, base: RefResult | undefined, limits: Limits, runs: number): string {
  const baseOf = (page: string): Metrics | undefined => base?.pages.find((p) => p.page === page)?.median;
  const rows = head.pages.map(({ page, median: m }) => `| \`${page}\` | ${KEYS.map((key) => pair(key, baseOf(page), m)).join(" | ")} |`);
  const spread = widestSpread(head.pages);
  const found = breaches(head, limits);
  return [
    heading(runs),
    "",
    "| Page | Score | LCP | TBT | CLS |",
    "|---|---:|---:|---:|---:|",
    ...rows,
    "",
    base === undefined ? `Measured \`${head.ref}\`.` : `Each cell reads \`${base.ref}\`${ARROW}this PR.`,
    `Run-to-run spread on this PR (the widest max − min over ${runs} runs on any page): score ${spread.score}, LCP ${ms(spread.lcp)}, TBT ${ms(spread.tbt)}, CLS ${cls(spread.cls)}.`,
    `Limits in \`${LIMITS_FILE}\` (warn only): score ≥ ${limits.minScore}, LCP ≤ ${ms(limits.maxLcpMs)}, TBT ≤ ${ms(limits.maxTbtMs)}, CLS ≤ ${cls(limits.maxCls)}.`,
    found.length === 0 ? NO_BREACH : found.map((line) => `- Warning: ${line}`).join("\n"),
  ].join("\n");
}
