import { Either, Schema } from "effect";
import {
  COLUMN_BASE,
  COLUMN_CHANGE,
  COLUMN_HEAD,
  ENTRY_KEY,
  ENTRY_LABEL,
  LOAD_FORMULA,
  MISSING_CELL,
  NEW_CELL,
  NO_SHIPPED_CODE,
  NO_SHIPPED_PATTERN,
  REMOVED_CELL,
  ROOT_KEY,
  ROOT_LABEL,
  ROOT_ROUTE_ID,
  SHIPPED_FILES,
  SHIPPED_PREFIXES,
  SIZE_HEADING,
  SLOW_LINK_KBITS_PER_SECOND,
  SLOW_LINK_NAME,
  COMPARISON_HEADER_PATTERN,
  FENCED_BLOCK_PATTERN,
  TEST_PATH_PATTERN,
  WORKER_ROW_PATTERN,
  UNCHANGED_CELL,
  UNMATCHED_PAGES_LEAD,
  UNIT_BYTES,
  WORKER_GZIP_PATTERN,
  WORKER_KEY,
  WORKER_LABEL,
  routeKey,
  routeLabel,
} from "./size-constants";
import { NUMBER_LOCALE } from "./shell-constants";

const Files = Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] });

const RouteSchema = Schema.Struct({
  id: Schema.String,
  parentId: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  hasDefaultExport: Schema.optional(Schema.Boolean),
  module: Schema.String,
  imports: Files,
  css: Files,
});

const ManifestSchema = Schema.Struct({
  entry: Schema.Struct({ module: Schema.String, imports: Files, css: Files }),
  routes: Schema.Record({ key: Schema.String, value: RouteSchema }),
});

const RowSchema = Schema.Struct({ key: Schema.String, label: Schema.String, bytes: Schema.Number });
const ReportSchema = Schema.Struct({ rows: Schema.Array(RowSchema) });

export type Manifest = typeof ManifestSchema.Type;
export type ManifestRoute = typeof RouteSchema.Type;
export type SizeReport = typeof ReportSchema.Type;

export interface ComparedRow {
  key: string;
  label: string;
  base: number | undefined;
  head: number | undefined;
}

const objectText = (text: string): string => text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);

export const parseManifest = (text: string): Either.Either<Manifest, string> =>
  Either.mapLeft(
    Schema.decodeUnknownEither(Schema.parseJson(ManifestSchema))(objectText(text)),
    (error) => `cannot read the React Router manifest: ${error.message.split("\n")[0]}`,
  );

export const parseReport = (text: string): Either.Either<SizeReport, string> =>
  Either.mapLeft(
    Schema.decodeUnknownEither(Schema.parseJson(ReportSchema))(text),
    (error) => `cannot read the saved size report: ${error.message.split("\n")[0]}`,
  );

export const parseWorkerGzip = (output: string): Either.Either<number, string> => {
  const match = output.match(WORKER_GZIP_PATTERN);
  const unit = UNIT_BYTES[match?.[2] ?? ""];
  if (!match?.[1] || unit === undefined) return Either.left("cannot find the gzip size in the `wrangler deploy --dry-run` output");
  return Either.right(Math.round(Number(match[1]) * unit));
};

export function chainOf(manifest: Manifest, id: string): ManifestRoute[] {
  const route = manifest.routes[id];
  if (!route) return [];
  return route.parentId === undefined ? [route] : [...chainOf(manifest, route.parentId), route];
}

export const pathOf = (chain: ManifestRoute[]): string =>
  `/${chain
    .map((route) => (route.path ?? "").replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/")}`;

export const pages = (manifest: Manifest): ManifestRoute[] =>
  Object.values(manifest.routes).filter(
    (route) => route.id !== ROOT_ROUTE_ID && route.hasDefaultExport === true && !Object.values(manifest.routes).some((other) => other.parentId === route.id),
  );

export function firstLoad(manifest: Manifest, id: string): { js: string[]; css: string[] } {
  const chain = chainOf(manifest, id);
  const js = [manifest.entry.module, ...manifest.entry.imports, ...chain.flatMap((route) => [route.module, ...route.imports])];
  const css = [...manifest.entry.css, ...chain.flatMap((route) => route.css)];
  return { js: [...new Set(js)], css: [...new Set(css)] };
}

const total = (files: string[], gzipSizes: Record<string, number>): number => files.reduce((sum, file) => sum + (gzipSizes[file] ?? 0), 0);

export function measure(manifest: Manifest, gzipSizes: Record<string, number>, workerGzip: number): SizeReport {
  const root = manifest.routes[ROOT_ROUTE_ID];
  const routeRows = pages(manifest).flatMap((route) => {
    const files = firstLoad(manifest, route.id);
    const path = pathOf(chainOf(manifest, route.id));
    return [
      { key: routeKey(route.id, "js"), label: routeLabel(path, "js"), bytes: total(files.js, gzipSizes) },
      { key: routeKey(route.id, "css"), label: routeLabel(path, "css"), bytes: total(files.css, gzipSizes) },
    ];
  });
  return {
    rows: [
      { key: WORKER_KEY, label: WORKER_LABEL, bytes: workerGzip },
      { key: ENTRY_KEY, label: ENTRY_LABEL, bytes: gzipSizes[manifest.entry.module] ?? 0 },
      { key: ROOT_KEY, label: ROOT_LABEL, bytes: root ? (gzipSizes[root.module] ?? 0) : 0 },
      ...routeRows,
    ],
  };
}

export function compare(base: SizeReport, head: SizeReport): ComparedRow[] {
  const baseBytes = new Map(base.rows.map((row) => [row.key, row.bytes]));
  const headKeys = new Set(head.rows.map((row) => row.key));
  return [
    ...head.rows.map((row) => ({ key: row.key, label: row.label, base: baseBytes.get(row.key), head: row.bytes })),
    ...base.rows.filter((row) => !headKeys.has(row.key)).map((row) => ({ key: row.key, label: row.label, base: row.bytes, head: undefined })),
  ];
}

const formatBytes = (bytes: number): string => bytes.toLocaleString(NUMBER_LOCALE);

const signed = (value: number, text: string): string => (value > 0 ? `+${text}` : value < 0 ? `-${text}` : text);

export function formatChange(base: number | undefined, head: number | undefined): string {
  if (base === undefined) return NEW_CELL;
  if (head === undefined) return REMOVED_CELL;
  const delta = head - base;
  if (delta === 0) return UNCHANGED_CELL;
  const percent = base === 0 ? "" : ` (${signed(delta, `${Math.abs((delta / base) * 100).toFixed(1)}%`)})`;
  return `${signed(delta, formatBytes(Math.abs(delta)))}${percent}`;
}

const cell = (bytes: number | undefined): string => (bytes === undefined ? MISSING_CELL : formatBytes(bytes));

export const renderTable = (head: SizeReport): string =>
  [`| | ${COLUMN_HEAD} |`, "|---|---:|", ...head.rows.map((row) => `| ${row.label} | ${formatBytes(row.bytes)} |`)].join("\n");

export const renderComparison = (rows: ComparedRow[]): string =>
  [
    `| | ${COLUMN_BASE} | ${COLUMN_HEAD} | ${COLUMN_CHANGE} |`,
    "|---|---:|---:|---:|",
    ...rows.map((row) => `| ${row.label} | ${cell(row.base)} | ${cell(row.head)} | ${formatChange(row.base, row.head)} |`),
  ].join("\n");

export const extraMilliseconds = (bytes: number): number => (bytes * 8) / SLOW_LINK_KBITS_PER_SECOND;

const routeOf = (key: string): string | undefined => key.match(/^route:(.+):(js|css)$/)?.[1];

const pageLabel = (row: ComparedRow, id: string): string => row.label.split(" ")[0] ?? id;

function unmatchedPages(rows: ComparedRow[]): string {
  const pages = new Map<string, string>();
  for (const row of rows) {
    const id = routeOf(row.key);
    if (id === undefined || (row.base !== undefined && row.head !== undefined)) continue;
    pages.set(id, `${pageLabel(row, id)} (${row.base === undefined ? NEW_CELL : REMOVED_CELL})`);
  }
  if (pages.size === 0) return "";
  return ` ${UNMATCHED_PAGES_LEAD} ${[...pages.values()].join(", ")}.`;
}

export function loadTimeLine(rows: ComparedRow[]): string {
  const byRoute = new Map<string, { label: string; delta: number }>();
  for (const row of rows) {
    const id = routeOf(row.key);
    if (id === undefined || row.base === undefined || row.head === undefined) continue;
    const seen = byRoute.get(id);
    byRoute.set(id, { label: pageLabel(row, id), delta: (seen?.delta ?? 0) + row.head - row.base });
  }
  const largest = [...byRoute.values()].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  const unmatched = unmatchedPages(rows);
  if (!largest || largest.delta === 0) {
    return `Load time: no page on both sides changed its first-load JS or CSS, so no extra transfer time on ${SLOW_LINK_NAME}.${unmatched}`;
  }
  const ms = extraMilliseconds(Math.abs(largest.delta));
  const bytes = signed(largest.delta, formatBytes(Math.abs(largest.delta)));
  return `Load time: the largest first-load change is ${largest.label}, ${bytes} bytes gzip, about ${signed(largest.delta, ms.toFixed(1))} ms on ${SLOW_LINK_NAME}; ${LOAD_FORMULA}.${unmatched}`;
}

export const touchesShippedCode = (paths: string[]): string[] =>
  paths.filter((path) => SHIPPED_FILES.includes(path) || (SHIPPED_PREFIXES.some((prefix) => path.startsWith(prefix)) && !TEST_PATH_PATTERN.test(path)));

const carriesTable = (body: string): boolean => {
  const prose = body.replace(FENCED_BLOCK_PATTERN, "");
  return COMPARISON_HEADER_PATTERN.test(prose) && WORKER_ROW_PATTERN.test(prose);
};

export function prSection(changedPaths: string[], rows: ComparedRow[]): string {
  if (touchesShippedCode(changedPaths).length === 0) return `${SIZE_HEADING}\n\n${NO_SHIPPED_CODE}`;
  return `${SIZE_HEADING}\n\n${renderComparison(rows)}\n\n${loadTimeLine(rows)}`;
}

export function checkBody(body: string, changedPaths: string[]): Either.Either<string, string> {
  const shipped = touchesShippedCode(changedPaths);
  if (shipped.length === 0) return Either.right("no shipped code changed, so no size table is needed");
  if (carriesTable(body)) return Either.right("the body carries the size table");
  const named = shipped.slice(0, 3).join(", ");
  const claim = NO_SHIPPED_PATTERN.test(body) ? ` The body says "${NO_SHIPPED_CODE}", but it changes ${named}.` : "";
  return Either.left(
    `This PR changes shipped code (${named}) and its body has no size table.${claim} Run \`bun run size --base <base branch> --pr-body\` and paste its output into the PR body.`,
  );
}
