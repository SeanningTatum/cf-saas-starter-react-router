import { stableJson } from "./harness-config";
import { ledgerChecksum } from "./run-telemetry";
import { RUN_HEADING_PREFIX, SECTION_PREFIX, SIZE_HEADING_LINE, WHOLE_WAVE_NOTE } from "./wave-constants";
import type { Ticket, WaveState } from "./wave-state";

export const outLine = (out: unknown): string => JSON.stringify({ out, check: ledgerChecksum(stableJson(out)) });

const prText = (t: Ticket) => (t.pr === null ? "no PR" : `PR #${t.pr}`);

export const ownerSteps = (state: WaveState): { n: number; step: string }[] => state.tickets.flatMap((t) => t.ownerSteps.map((step) => ({ n: t.n, step })));

const list = (ns: readonly number[]) => ns.map((n) => `#${n}`).join(", ");

function headLines(state: WaveState): string[] {
  const planWord = state.planApproved ? "approved" : state.tracks.length ? "waiting for approval" : "not made yet";
  const b = state.batch;
  const running = b && !b.closed ? `; batch ${b.index + 1} running (${list(b.tickets)}), gate ${b.gate || "not run"}` : "";
  const lines = [
    `wave ${state.slug}: ${state.wave} -> ${state.into}`,
    `plan ${planWord}; ${state.tracksAtOnce} track(s) at once; ${state.reviewRounds} review round(s)`,
    `batches done: ${state.batchesDone}${running}`,
  ];
  if (state.paused) lines.push(`PAUSED: run \`bun scripts/wave.ts resume ${state.slug}\`, then start the workflow again`);
  if (state.halt) lines.push(`HALTED on a shared failure in ${list(state.halt.tickets)}: ${state.halt.signature}`);
  return lines;
}

const ticketLine = (t: Ticket) => `  #${t.n} ${t.status} ${prText(t)} [${t.kind}${t.wide ? ", wide" : ""}] ${t.title}${t.why ? ` (${t.why})` : ""}`;

const trackLines = (state: WaveState): string[] =>
  state.tracks.flatMap((track) => [`track ${track.id}:`, ...state.tickets.filter((t) => track.tickets.includes(t.n)).map(ticketLine)]);

const keptFindings = (state: WaveState): { n: number; text: string }[] => state.tickets.flatMap((t) => t.kept.map((text) => ({ n: t.n, text })));

function tailLines(state: WaveState): string[] {
  const steps = ownerSteps(state);
  const kept = keptFindings(state);
  return [
    ...(state.projected.length ? [`planned batches: ${state.projected.map((b, i) => `${i + 1}: ${list(b)}`).join(" | ")}`] : []),
    ...state.notes.map((note) => `note: ${note}`),
    ...(steps.length ? ["owner steps:", ...steps.map((s) => `  #${s.n}: ${s.step}`)] : []),
    ...(kept.length ? ["kept findings (P2 and P3, never blocking):", ...kept.map((k) => `  #${k.n}: ${k.text}`)] : []),
    ...(state.rollupPr === null ? [] : [`roll-up: PR #${state.rollupPr} (never merged by the run)`]),
    ...(state.log.length ? ["last events:", ...state.log.slice(-8).map((l) => `  ${l}`)] : []),
  ];
}

export const statusLines = (state: WaveState): string[] => [...headLines(state), ...trackLines(state), ...tailLines(state)];

const mergedLines = (state: WaveState): string[] =>
  state.tickets.filter((t) => t.status === "merged").map((t) => `- #${t.n} ${t.title}${t.pr === null ? "" : ` (PR #${t.pr})`}`);

const stepLines = (state: WaveState): string[] => {
  const steps = ownerSteps(state);
  return steps.length ? steps.map((s) => `- #${s.n}: ${s.step}`) : ["- None reported."];
};

export function rollupBody(state: WaveState, size = ""): string {
  const skipped = state.tickets.filter((t) => t.status === "skipped");
  return [
    `Roll-up of wave \`${state.wave}\` into \`${state.into}\`. The wave workflow opened this PR and never merges it.`,
    WHOLE_WAVE_NOTE,
    "",
    "## Merged",
    ...mergedLines(state),
    ...(skipped.length ? ["", "## Skipped", ...skipped.map((t) => `- #${t.n} ${t.title}${t.why ? `: ${t.why}` : ""}`)] : []),
    "",
    "## Human steps",
    ...stepLines(state),
    ...(size.trim() ? ["", size.trim()] : []),
  ].join("\n");
}

const dropSection = (body: string, isHeading: (line: string) => boolean): string => {
  const lines = body.split("\n");
  const from = lines.findIndex(isHeading);
  if (from < 0) return body;
  const length = lines.slice(from + 1).findIndex((line) => line.startsWith(SECTION_PREFIX));
  const kept = length < 0 ? lines.slice(0, from) : [...lines.slice(0, from), ...lines.slice(from + 1 + length)];
  return kept.join("\n");
};

export function mergeRollupBody(existing: string, state: WaveState, date: string, size = ""): string {
  const heading = `${RUN_HEADING_PREFIX}${date} (${state.slug})`;
  const human = dropSection(
    dropSection(existing, (line) => line.trim() === SIZE_HEADING_LINE),
    (line) => line.trim() === heading,
  ).trimEnd();
  const section = [heading, "", ...mergedLines(state), "", "### Human steps", ...stepLines(state)].join("\n");
  return [human, section, ...(size.trim() ? [size.trim()] : [])].filter(Boolean).join("\n\n");
}
