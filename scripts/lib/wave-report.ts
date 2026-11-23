import { stableJson } from "./harness-config";
import { ledgerChecksum } from "./run-telemetry";
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

function tailLines(state: WaveState): string[] {
  const steps = ownerSteps(state);
  return [
    ...(state.projected.length ? [`planned batches: ${state.projected.map((b, i) => `${i + 1}: ${list(b)}`).join(" | ")}`] : []),
    ...state.notes.map((note) => `note: ${note}`),
    ...(steps.length ? ["owner steps:", ...steps.map((s) => `  #${s.n}: ${s.step}`)] : []),
    ...(state.rollupPr === null ? [] : [`roll-up: PR #${state.rollupPr} (never merged by the run)`]),
    ...(state.log.length ? ["last events:", ...state.log.slice(-8).map((l) => `  ${l}`)] : []),
  ];
}

export const statusLines = (state: WaveState): string[] => [...headLines(state), ...trackLines(state), ...tailLines(state)];

export function rollupBody(state: WaveState): string {
  const merged = state.tickets.filter((t) => t.status === "merged");
  const skipped = state.tickets.filter((t) => t.status === "skipped");
  const steps = ownerSteps(state);
  return [
    `Roll-up of wave \`${state.wave}\` into \`${state.into}\`. The wave workflow opened this PR and never merges it.`,
    "",
    "## Merged",
    ...merged.map((t) => `- #${t.n} ${t.title}${t.pr === null ? "" : ` (PR #${t.pr})`}`),
    ...(skipped.length ? ["", "## Skipped", ...skipped.map((t) => `- #${t.n} ${t.title}${t.why ? `: ${t.why}` : ""}`)] : []),
    "",
    "## Human steps",
    ...(steps.length ? steps.map((s) => `- #${s.n}: ${s.step}`) : ["- None reported."]),
  ].join("\n");
}
