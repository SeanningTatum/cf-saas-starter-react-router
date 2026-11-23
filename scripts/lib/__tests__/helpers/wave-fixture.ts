import { Either } from "effect";
import type { GuardResult } from "../../wave-guard";
import { planWave } from "../../wave-plan";
import { newTicket, type PlanTicketInput, type WaveState } from "../../wave-state";

export const WAVE = "v3/wave-2";
export const INTO = "release/v3.0";
export const SHA_A = "a".repeat(40);
export const SHA_B = "b".repeat(40);

export const ticket = (n: number, over: Partial<PlanTicketInput> = {}): PlanTicketInput => ({
  n,
  title: `ticket ${n}`,
  kind: "build",
  blockedBy: [],
  files: [`app/f${n}.ts`],
  wide: false,
  ...over,
});

export function waveOf(tickets: PlanTicketInput[], over: Partial<WaveState> = {}): WaveState {
  const max = over.tracksAtOnce ?? 2;
  const plan = Either.getOrThrowWith(planWave(tickets, max), (why) => new Error(why));
  const trackOf = new Map(plan.tracks.flatMap((t) => t.tickets.map((n) => [n, t.id] as const)));
  return {
    version: 1,
    slug: "wave-two",
    wave: WAVE,
    into: INTO,
    tracksAtOnce: max,
    reviewRounds: 1,
    paused: false,
    planApproved: true,
    notes: plan.notes,
    tracks: plan.tracks,
    projected: plan.batches,
    tickets: tickets.map((t) => newTicket(t, trackOf.get(t.n) ?? "")),
    batch: null,
    batchesDone: 0,
    failures: [],
    halt: null,
    rollupPr: null,
    log: [],
    ...over,
  };
}

export const guardOf = (verdict: GuardResult["verdict"], over: Partial<GuardResult> = {}): GuardResult => ({
  verdict,
  head: SHA_B,
  mergeable: "MERGEABLE",
  red: [],
  pending: [],
  unanswered: [],
  line: `verdict ${verdict}`,
  ...over,
});
