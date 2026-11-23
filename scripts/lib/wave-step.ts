import {
  MAX_CHECK_FAILURES,
  MAX_GATE_FAILURES,
  MAX_MERGE_PASSES,
  MAX_PENDING_ROUNDS,
  MAX_THREAD_ROUNDS,
  SIGNATURE_DIGITS,
  SIGNATURE_HEX,
  SIGNATURE_MAX,
  SIGNATURE_PATHS,
  SIGNATURE_SPACE,
} from "./wave-constants";
import type { GuardResult } from "./wave-guard";
import { nextBatch } from "./wave-plan";
import { type FixKind, newBatch, type Ticket, type WaveEvent, type WaveState, ticketOf, withLog, withTicket } from "./wave-state";

export type TicketStep = "build" | "review" | "fix-review" | "fix-check" | "answer-threads" | "refresh" | "guard" | "done";

export interface TicketView {
  n: number;
  title: string;
  kind: Ticket["kind"];
  track: string;
  status: Ticket["status"];
  pr: number | null;
  branch: string;
  head: string;
  round: number;
  findings: readonly string[];
  why: string;
  step: TicketStep;
}

export type WaveStep =
  | { kind: "plan" }
  | { kind: "tickets"; batch: number; tickets: TicketView[] }
  | { kind: "merge"; batch: number }
  | { kind: "gate"; batch: number }
  | { kind: "rollup" }
  | { kind: "stop"; stop: "paused" | "plan" | "rollup"; pr: number | null }
  | { kind: "stop"; stop: "shared-failure"; signature: string; tickets: number[] }
  | { kind: "stop"; stop: "stuck"; tickets: TicketView[] }
  | { kind: "stop"; stop: "gate"; batch: number; log: string };

const WORKING = new Set<Ticket["status"]>(["queued", "open"]);
const SETTLED = new Set<Ticket["status"]>(["merged", "skipped"]);

export const signatureOf = (line: string): string =>
  line
    .toLowerCase()
    .replace(SIGNATURE_PATHS, "…/")
    .replace(SIGNATURE_HEX, "#")
    .replace(SIGNATURE_DIGITS, "0")
    .replace(SIGNATURE_SPACE, " ")
    .trim()
    .slice(0, SIGNATURE_MAX);

export function nextTicketStep(t: Ticket, reviewRounds: number): TicketStep {
  if (t.status === "queued") return "build";
  if (t.status !== "open") return "done";
  if (t.refresh) return "refresh";
  if (t.needsFix) return "fix-review";
  if (t.reviewed < reviewRounds || (t.reviewBlocking && t.reviewed === reviewRounds && reviewRounds > 0)) return "review";
  if (t.needsCheckFix) return "fix-check";
  if (t.needsThreads) return "answer-threads";
  return "guard";
}

export const viewOf = (t: Ticket, reviewRounds: number): TicketView => ({
  n: t.n,
  title: t.title,
  kind: t.kind,
  track: t.track,
  status: t.status,
  pr: t.pr,
  branch: t.branch,
  head: t.head,
  round: t.reviewed + 1,
  findings: t.findings,
  why: t.why,
  step: nextTicketStep(t, reviewRounds),
});

function recordFailure(state: WaveState, n: number, line: string): WaveState {
  const t = ticketOf(state, n);
  const signature = signatureOf(line);
  if (!t || !signature) return state;
  const failures = [...state.failures, { n, track: t.track, signature }];
  const hits = failures.filter((f) => f.signature === signature);
  const shared = new Set(hits.map((f) => f.track)).size >= 2;
  if (!shared || state.halt) return { ...state, failures };
  const tickets = [...new Set(hits.map((f) => f.n))].sort((a, b) => a - b);
  const unstuck = tickets.reduce(
    (s, k) => withTicket(s, k, (x) => (x.status === "stuck" && signatureOf(x.why) === signature ? { status: x.pr === null ? "queued" : "open", why: "" } : {})),
    state,
  );
  return { ...unstuck, failures, halt: { signature, tickets } };
}

const stuck = (state: WaveState, n: number, why: string): WaveState =>
  withLog(
    withTicket(state, n, () => ({ status: "stuck", why })),
    `#${n} stuck: ${why}`,
  );

export function applyEvent(state: WaveState, e: WaveEvent): WaveState {
  if (!ticketOf(state, e.n)) return state;
  switch (e.type) {
    case "opened":
      return withLog(
        withTicket(state, e.n, () => ({ status: "open", pr: e.pr, branch: e.branch, head: e.head, ownerSteps: [...e.ownerSteps] })),
        `#${e.n} opened PR #${e.pr}`,
      );
    case "failed": {
      const after = recordFailure(state, e.n, e.line);
      return after.halt?.signature === signatureOf(e.line) ? after : stuck(after, e.n, e.line);
    }
    case "reviewed":
      return withTicket(state, e.n, (t) => ({
        reviewed: t.reviewed + 1,
        reviewBlocking: e.blocking.length > 0,
        needsFix: e.blocking.length > 0,
        findings: [...e.blocking],
      }));
    case "fixed": {
      const after = e.cause ? recordFailure(state, e.n, e.cause) : state;
      return withTicket(after, e.n, (t) => ({ head: e.head || t.head, ...clearFix(t, e.what) }));
    }
  }
}

function clearFix(t: Ticket, what: FixKind): Partial<Ticket> {
  switch (what) {
    case "review":
      return { needsFix: false, findings: [] };
    case "check":
      return { needsCheckFix: false };
    case "threads":
      return { needsThreads: false, threadRounds: t.threadRounds + 1 };
    case "refresh":
      return { refresh: false };
  }
}

export function applyGuard(state: WaveState, n: number, g: GuardResult): WaveState {
  const t = ticketOf(state, n);
  if (!t) return state;
  const at = withTicket(state, n, () => ({ head: g.head || t.head }));
  switch (g.verdict) {
    case "green":
      return withTicket(at, n, () => ({ status: "green", pendingRounds: 0 }));
    case "merged":
      return withLog(
        withTicket(at, n, () => ({ status: "merged" })),
        `#${n} was merged outside the run`,
      );
    case "closed":
      return stuck(at, n, g.line);
    case "threads":
      if (t.threadRounds >= MAX_THREAD_ROUNDS) return stuck(at, n, `review threads still unanswered after ${MAX_THREAD_ROUNDS} rounds`);
      return withTicket(at, n, () => ({ needsThreads: true }));
    case "pending":
      if (t.pendingRounds + 1 < MAX_PENDING_ROUNDS) return withTicket(at, n, () => ({ pendingRounds: t.pendingRounds + 1 }));
      return failCheck(at, t, "checks did not finish");
    case "red":
      return failCheck(at, t, g.line);
  }
}

function failCheck(state: WaveState, t: Ticket, line: string): WaveState {
  const failures = t.checkFailures + 1;
  const counted = withTicket(state, t.n, () => ({ checkFailures: failures, pendingRounds: 0 }));
  if (failures >= MAX_CHECK_FAILURES) return stuck(counted, t.n, `a check failed twice: ${line}`);
  return withTicket(counted, t.n, () => ({ needsCheckFix: true }));
}

export function afterMerge(state: WaveState, merged: readonly number[], refused: readonly { n: number; why: string }[]): WaveState {
  if (!state.batch) return state;
  const next = merged.reduce(
    (s, n) =>
      withLog(
        withTicket(s, n, () => ({ status: "merged" })),
        `#${n} merged`,
      ),
    state,
  );
  return refused.reduce((s, r) => {
    const refusals = (ticketOf(s, r.n)?.mergeRefusals ?? 0) + 1;
    if (refusals >= MAX_MERGE_PASSES) return stuck(s, r.n, `could not merge after ${MAX_MERGE_PASSES} tries: ${r.why}`);
    return withTicket(s, r.n, () => ({ status: "open", refresh: true, mergeRefusals: refusals }));
  }, next);
}

export function applyGate(state: WaveState, head: string, code: number, log: string): WaveState {
  if (!state.batch) return state;
  const pass = code === 0;
  const gateFailures = pass ? state.batch.gateFailures : state.batch.gateFailures + 1;
  return withLog(
    { ...state, batch: { ...state.batch, gate: pass ? "pass" : "fail", gateFailures, gateLog: log } },
    `batch ${state.batch.index + 1} gate on ${head.slice(0, 7)}: ${pass ? "green" : "red"}`,
  );
}

const settledSet = (state: WaveState) => new Set(state.tickets.filter((t) => SETTLED.has(t.status)).map((t) => t.n));

function startBatch(state: WaveState): { state: WaveState; step: WaveStep | null } {
  const blocked = new Set(state.tickets.filter((t) => t.status === "stuck").map((t) => t.n));
  const picked = nextBatch({ tracks: state.tracks, tickets: state.tickets, done: settledSet(state), blocked, max: state.tracksAtOnce });
  if (!picked.length) return { state, step: null };
  const index = state.batchesDone;
  let next: WaveState = { ...state, batch: newBatch(index, picked) };
  next = picked.reduce((s, n) => withTicket(s, n, () => ({ batch: index })), next);
  next = withLog(next, `batch ${index + 1} started: ${picked.map((n) => `#${n}`).join(", ")}`);
  return { state: next, step: { kind: "tickets", batch: index, tickets: picked.flatMap((n) => viewsOf(next, [n])) } };
}

const viewsOf = (state: WaveState, ns: readonly number[]): TicketView[] =>
  ns.flatMap((n) => {
    const t = ticketOf(state, n);
    return t ? [viewOf(t, state.reviewRounds)] : [];
  });

function batchStep(state: WaveState): { state: WaveState; step: WaveStep | null } {
  const b = state.batch;
  if (!b || b.closed) return { state, step: null };
  const work = b.tickets.filter((n) => WORKING.has(ticketOf(state, n)?.status ?? "merged"));
  if (work.length) return { state, step: { kind: "tickets", batch: b.index, tickets: viewsOf(state, work) } };
  const green = b.tickets.some((n) => ticketOf(state, n)?.status === "green");
  if (green) return { state, step: { kind: "merge", batch: b.index } };
  const mergedAny = b.tickets.some((n) => ticketOf(state, n)?.status === "merged");
  if (mergedAny && b.gate !== "pass") {
    if (b.gateFailures >= MAX_GATE_FAILURES) return { state, step: { kind: "stop", stop: "gate", batch: b.index, log: b.gateLog } };
    return { state, step: { kind: "gate", batch: b.index } };
  }
  const closed = withLog({ ...state, batch: { ...b, closed: true }, batchesDone: state.batchesDone + 1 }, `batch ${b.index + 1} closed`);
  return { state: closed, step: null };
}

export function nextWaveStep(state: WaveState): { state: WaveState; step: WaveStep } {
  if (state.paused) return { state, step: { kind: "stop", stop: "paused", pr: state.rollupPr } };
  if (state.halt) return { state, step: { kind: "stop", stop: "shared-failure", signature: state.halt.signature, tickets: [...state.halt.tickets] } };
  if (!state.tracks.length) return { state, step: { kind: "plan" } };
  if (!state.planApproved) return { state, step: { kind: "stop", stop: "plan", pr: null } };
  const inBatch = batchStep(state);
  if (inBatch.step) return { state: inBatch.state, step: inBatch.step };
  const after = inBatch.state;
  const stuckOnes = after.tickets.filter((t) => t.status === "stuck");
  if (stuckOnes.length) return { state: after, step: { kind: "stop", stop: "stuck", tickets: stuckOnes.map((t) => viewOf(t, after.reviewRounds)) } };
  const started = startBatch(after);
  if (started.step) return { state: started.state, step: started.step };
  const left = after.tickets.filter((t) => !SETTLED.has(t.status));
  if (left.length) return { state: after, step: { kind: "stop", stop: "stuck", tickets: left.map((t) => viewOf(t, after.reviewRounds)) } };
  if (after.rollupPr === null) return { state: after, step: { kind: "rollup" } };
  return { state: after, step: { kind: "stop", stop: "rollup", pr: after.rollupPr } };
}
