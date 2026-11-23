import { Either } from "effect";
import { type Ticket, ticketOf, type WaveState, withLog, withTicket } from "./wave-state";

export interface PersonChange {
  state: WaveState;
  message: string;
}

const RESET: Partial<Ticket> = { checkFailures: 0, threadRounds: 0, pendingRounds: 0, needsCheckFix: false, needsThreads: false, mergeRefusals: 0, why: "" };

export const pause = (state: WaveState): PersonChange => ({
  state: withLog({ ...state, paused: true }, "paused by a person"),
  message: `${state.slug} paused; the run stops at its next step`,
});

export function resume(state: WaveState): PersonChange {
  const halted = state.halt?.signature;
  const failures = state.failures.filter((f) => f.signature !== halted);
  const batch = state.batch && state.batch.gate === "fail" ? { ...state.batch, gate: "" as const, gateFailures: 0 } : state.batch;
  return {
    state: withLog({ ...state, paused: false, halt: null, failures, batch }, "resumed by a person"),
    message: `${state.slug} resumed; start the workflow again with the same args`,
  };
}

export function retry(state: WaveState, n: number): Either.Either<PersonChange, string> {
  const t = ticketOf(state, n);
  if (!t) return Either.left(`#${n} is not in this wave`);
  if (t.status !== "stuck") return Either.left(`#${n} is ${t.status}, not stuck`);
  const next = withTicket(state, n, () => (t.pr === null ? { ...RESET, status: "queued" } : { ...RESET, status: "open", refresh: true }));
  return Either.right({ state: withLog(next, `#${n} retried by a person`), message: `#${n} will be worked again` });
}

export function dependentsOf(state: WaveState, n: number): number[] {
  const out = new Set([n]);
  let grew = true;
  while (grew) {
    const more = state.tickets.filter((x) => !out.has(x.n) && x.status !== "merged" && x.blockedBy.some((b) => out.has(b)));
    for (const x of more) out.add(x.n);
    grew = more.length > 0;
  }
  return [...out].sort((a, b) => a - b);
}

export function skip(state: WaveState, n: number): Either.Either<PersonChange, string> {
  const t = ticketOf(state, n);
  if (!t) return Either.left(`#${n} is not in this wave`);
  if (t.status === "merged") return Either.left(`#${n} is already merged`);
  const gone = dependentsOf(state, n);
  const next = gone.reduce((s, k) => withTicket(s, k, () => ({ status: "skipped", why: k === n ? "skipped by a person" : `blocked by skipped #${n}` })), state);
  const list = gone.map((k) => `#${k}`).join(", ");
  return Either.right({ state: withLog(next, `skipped ${list}`), message: `skipped ${list}` });
}
