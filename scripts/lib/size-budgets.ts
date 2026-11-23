import { Either, Schema } from "effect";
import {
  BUDGETS_HEADING,
  BUDGETS_PATH,
  BUDGET_COLUMNS,
  LOWER_HINT_BYTES,
  NOISE_SLACK_BYTES,
  NO_TARGET_CELL,
  PAGE_JS_LABEL_PATTERN,
  SHRINK_RULE,
  STATUS_LOWER,
  STATUS_OK,
  STATUS_OVER,
  STATUS_UNBUDGETED,
  WORKER_NAME,
} from "./size-budgets-constants";
import { NUMBER_LOCALE } from "./shell-constants";
import { WORKER_KEY } from "./size-constants";
import type { SizeReport } from "./size-report";

const EntrySchema = Schema.Struct({ budget: Schema.Number, target: Schema.optional(Schema.Number) });
const BudgetsSchema = Schema.Struct({ worker: EntrySchema, pages: Schema.Record({ key: Schema.String, value: EntrySchema }) });

export type Budgets = typeof BudgetsSchema.Type;

export interface BudgetRow {
  name: string;
  measured: number;
  budget: number | undefined;
  target: number | undefined;
}

export const parseBudgets = (text: string): Either.Either<Budgets, string> =>
  Either.mapLeft(Schema.decodeUnknownEither(Schema.parseJson(BudgetsSchema))(text), (error) => `cannot read ${BUDGETS_PATH}: ${error.message.split("\n")[0]}`);

const bytes = (value: number): string => value.toLocaleString(NUMBER_LOCALE);

export function budgetRows(budgets: Budgets, report: SizeReport): BudgetRow[] {
  const pages = new Map<string, number>();
  for (const row of report.rows) {
    const path = row.label.match(PAGE_JS_LABEL_PATTERN)?.[1];
    if (path !== undefined) pages.set(path, Math.max(pages.get(path) ?? 0, row.bytes));
  }
  const worker = report.rows.find((row) => row.key === WORKER_KEY)?.bytes ?? 0;
  return [
    { name: WORKER_NAME, measured: worker, budget: budgets.worker.budget, target: budgets.worker.target },
    ...[...pages].map(([path, measured]) => ({ name: path, measured, budget: budgets.pages[path]?.budget, target: budgets.pages[path]?.target })),
  ];
}

const overshoot = (row: BudgetRow): number => (row.budget === undefined ? 0 : row.measured - row.budget);

const isOver = (row: BudgetRow): boolean => overshoot(row) > NOISE_SLACK_BYTES;

export function statusOf(row: BudgetRow): string {
  if (row.budget === undefined) return STATUS_UNBUDGETED;
  if (isOver(row)) return STATUS_OVER;
  return row.budget - row.measured > LOWER_HINT_BYTES ? STATUS_LOWER : STATUS_OK;
}

const targetCells = (row: BudgetRow): [string, string] =>
  row.target === undefined ? [NO_TARGET_CELL, NO_TARGET_CELL] : [bytes(row.target), bytes(Math.max(0, (row.budget ?? row.measured) - row.target))];

export function renderBudgets(rows: BudgetRow[]): string {
  const body = rows.map((row) => {
    const [target, gap] = targetCells(row);
    const left = row.budget === undefined ? NO_TARGET_CELL : bytes(row.budget - row.measured);
    const budget = row.budget === undefined ? NO_TARGET_CELL : bytes(row.budget);
    return `| ${row.name} | ${bytes(row.measured)} | ${budget} | ${left} | ${target} | ${gap} | ${statusOf(row)} |`;
  });
  return [
    `**${BUDGETS_HEADING}**`,
    "",
    `| ${BUDGET_COLUMNS.join(" | ")} |`,
    `|---|${BUDGET_COLUMNS.slice(1, -1)
      .map(() => "---:")
      .join("|")}|---|`,
    ...body,
  ].join("\n");
}

export function failures(rows: BudgetRow[]): string[] {
  return rows.flatMap((row) => {
    if (row.budget === undefined) {
      return [`${row.name} has no budget in ${BUDGETS_PATH}. Add "${row.name}": { "budget": ${row.measured} } under "pages" so the page cannot grow unseen.`];
    }
    if (!isOver(row)) return [];
    return [
      `${row.name} is ${bytes(overshoot(row))} bytes over its budget (${bytes(row.measured)} measured, budget ${bytes(row.budget)}). ` +
        `Find what grew with \`bun run size --base <base branch>\`, then lazy-load it, drop it or split it out of the first load. ${SHRINK_RULE}`,
    ];
  });
}

export function ratchet(base: Budgets, head: Budgets): string[] {
  const entries: Array<[string, number, number | undefined]> = [
    [WORKER_NAME, base.worker.budget, head.worker.budget],
    ...Object.entries(base.pages).map(([path, entry]): [string, number, number | undefined] => [path, entry.budget, head.pages[path]?.budget]),
  ];
  return entries.flatMap(([name, before, after]) => {
    if (after === undefined) return [`The budget for ${name} was removed from ${BUDGETS_PATH}. ${SHRINK_RULE}`];
    if (after > before) return [`The budget for ${name} went up from ${bytes(before)} to ${bytes(after)} in ${BUDGETS_PATH}. ${SHRINK_RULE}`];
    return [];
  });
}
