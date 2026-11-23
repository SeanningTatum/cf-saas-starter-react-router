import {
  CALL_HEADERS,
  COLUMN_GAP,
  COST_HEADERS,
  COST_TITLE,
  FAILURE_HEADERS,
  FAILURE_TITLE,
  FIRST_ATTEMPT,
  NOT_AVAILABLE,
  NO_AGENT_LABEL,
  OUTCOME_OK,
  PARTIAL_MARK,
  PERCENT_DECIMALS,
  PERCENT_SCALE,
  PHASE_HEADER,
  PHASE_SEPARATOR,
  SECONDS_DECIMALS,
  SLOWEST_TITLE,
  TIMING_NAME,
  TOKEN_DATA_NAME,
  TOTAL_LABEL,
} from "./run-telemetry-constants";
import type { Call, RunFile } from "./run-telemetry";

interface Column {
  text: string;
  partial: boolean;
  missing: number;
  total: number;
}

type Pick = (call: Call) => number | null;

function sumColumn(calls: ReadonlyArray<Call>, pick: Pick, decimals: number): Column {
  const values = calls.map(pick).filter((v): v is number => v !== null);
  const missing = calls.length - values.length;
  if (values.length === 0) return { text: NOT_AVAILABLE, partial: false, missing, total: calls.length };
  const sum = values.reduce((a, b) => a + b, 0).toFixed(decimals);
  const partial = missing > 0;
  return { text: partial ? `${sum}${PARTIAL_MARK}` : sum, partial, missing, total: calls.length };
}

const tokensIn: Pick = (c) => c.tokens?.in ?? null;
const tokensOut: Pick = (c) => c.tokens?.out ?? null;
const secondsOf: Pick = (c) => c.seconds;
const sumTokens = (calls: ReadonlyArray<Call>, pick: Pick) => sumColumn(calls, pick, 0);
const sumSeconds = (calls: ReadonlyArray<Call>) => sumColumn(calls, secondsOf, SECONDS_DECIMALS);

const escapeMarkdown = (text: string): string =>
  text
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n|\r/g, " ")
    .replace(/</g, "&lt;")
    .replace(/@/g, "(at)");

function renderTable(headers: readonly string[], rows: string[][], markdown: boolean): string[] {
  if (markdown) {
    const line = (cells: readonly string[]) => `| ${cells.map(escapeMarkdown).join(" | ")} |`;
    return [line(headers), line(headers.map((_, i) => (i === 0 ? "---" : "---:"))), ...rows.map(line)];
  }
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: readonly string[]) =>
    cells
      .map((cell, i) => (i === 0 ? cell.padEnd(widths[i] ?? 0) : cell.padStart(widths[i] ?? 0)))
      .join(COLUMN_GAP)
      .trimEnd();
  return [line(headers), ...rows.map(line)];
}

function partialNote(calls: ReadonlyArray<Call>, markdown: boolean): string[] {
  const parts = [
    { name: TOKEN_DATA_NAME, column: sumTokens(calls, tokensIn) },
    { name: TIMING_NAME, column: sumSeconds(calls) },
  ]
    .filter((p) => p.column.partial)
    .map(({ name, column }) => `${column.missing} of ${column.total} calls had no ${name}`);
  if (parts.length === 0) return [];
  return [`${markdown ? "\\" : ""}${PARTIAL_MARK} partial sum: ${parts.join("; ")}`];
}

const heading = (title: string, markdown: boolean): string[] => (markdown ? [`**${escapeMarkdown(title)}**`, ""] : [title]);

const callCells = (calls: ReadonlyArray<Call>): string[] => [
  String(calls.length),
  String(calls.filter((c) => c.attempt > FIRST_ATTEMPT).length),
  String(calls.filter((c) => c.outcome !== OUTCOME_OK).length),
  sumTokens(calls, tokensIn).text,
  sumTokens(calls, tokensOut).text,
  sumSeconds(calls).text,
];

export function summaryLines(run: RunFile, markdown: boolean): string[] {
  const out: string[] = [];
  for (const [workflow, { calls }] of Object.entries(run.workflows)) {
    if (out.length > 0) out.push("");
    const phases = [...new Set(calls.map((c) => c.phase))];
    const rows = phases.map((phase) => [phase === "" ? NO_AGENT_LABEL : phase, ...callCells(calls.filter((c) => c.phase === phase))]);
    rows.push([TOTAL_LABEL, ...callCells(calls)]);
    out.push(...heading(`${workflow} (${run.slug})`, markdown));
    out.push(...renderTable([PHASE_HEADER, ...CALL_HEADERS], rows, markdown));
    const note = partialNote(calls, markdown);
    if (note.length > 0) out.push("", ...note);
  }
  return out;
}

const callsOf = (run: RunFile): Call[] => Object.values(run.workflows).flatMap((w) => w.calls);

function costBlock(runs: ReadonlyArray<RunFile>, markdown: boolean): string[] {
  const rows = runs.map((run) => {
    const calls = callsOf(run);
    return [run.slug, String(calls.length), sumTokens(calls, tokensIn).text, sumTokens(calls, tokensOut).text, sumSeconds(calls).text];
  });
  const partialRuns = runs.filter((run) => sumTokens(callsOf(run), tokensIn).partial || sumSeconds(callsOf(run)).partial);
  const note = partialNote(partialRuns.flatMap(callsOf), markdown);
  return [...renderTable(COST_HEADERS, rows, markdown), ...(note.length > 0 ? ["", ...note] : [])];
}

function slowestPhase(runs: ReadonlyArray<RunFile>): string {
  const seconds = new Map<string, number>();
  for (const run of runs) {
    for (const [workflow, { calls }] of Object.entries(run.workflows)) {
      for (const call of calls) {
        if (call.seconds === null) continue;
        const key = `${workflow}${PHASE_SEPARATOR}${call.phase === "" ? NO_AGENT_LABEL : call.phase}`;
        seconds.set(key, (seconds.get(key) ?? 0) + call.seconds);
      }
    }
  }
  const best = [...seconds.entries()].reduce<[string, number] | null>((top, entry) => (top === null || entry[1] > top[1] ? entry : top), null);
  return best === null ? NOT_AVAILABLE : `${best[0]}, ${best[1].toFixed(SECONDS_DECIMALS)} seconds`;
}

function failureRows(runs: ReadonlyArray<RunFile>): string[][] {
  const byAgent = new Map<string, { calls: number; failed: number }>();
  for (const call of runs.flatMap(callsOf)) {
    const name = call.agent === "" ? NO_AGENT_LABEL : call.agent;
    const seen = byAgent.get(name) ?? { calls: 0, failed: 0 };
    seen.calls++;
    if (call.outcome !== OUTCOME_OK) seen.failed++;
    byAgent.set(name, seen);
  }
  const rate = (s: { calls: number; failed: number }) => s.failed / s.calls;
  return [...byAgent.entries()]
    .sort((a, b) => rate(b[1]) - rate(a[1]) || b[1].calls - a[1].calls || a[0].localeCompare(b[0]))
    .map(([name, s]) => [name, String(s.failed), String(s.calls), `${(rate(s) * PERCENT_SCALE).toFixed(PERCENT_DECIMALS)}%`]);
}

export function statsLines(runs: ReadonlyArray<RunFile>, markdown: boolean): string[] {
  return [
    ...heading(COST_TITLE, markdown),
    ...costBlock(runs, markdown),
    "",
    ...heading(SLOWEST_TITLE, markdown),
    slowestPhase(runs),
    "",
    ...heading(FAILURE_TITLE, markdown),
    ...renderTable(FAILURE_HEADERS, failureRows(runs), markdown),
  ];
}
