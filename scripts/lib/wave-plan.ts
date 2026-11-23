import { Either } from "effect";
import { TRACK_PREFIX } from "./wave-constants";

export interface PlanTicket {
  n: number;
  blockedBy: readonly number[];
  files: readonly string[];
  wide: boolean;
}

export interface Track {
  id: string;
  tickets: number[];
}

export interface WavePlan {
  tracks: Track[];
  batches: number[][];
  notes: string[];
}

export interface Schedule {
  tracks: readonly { id: string; tickets: readonly number[] }[];
  tickets: readonly PlanTicket[];
  done: ReadonlySet<number>;
  blocked: ReadonlySet<number>;
  max: number;
}

const byNumber = (a: number, b: number) => a - b;

export const pathsOverlap = (a: string, b: string): boolean => {
  const x = a.replace(/\/+$/, "");
  const y = b.replace(/\/+$/, "");
  return x === y || y.startsWith(`${x}/`) || x.startsWith(`${y}/`);
};

const shareFiles = (a: PlanTicket, b: PlanTicket): boolean => a.files.some((f) => b.files.some((g) => pathsOverlap(f, g)));

const inWaveBlockers = (t: PlanTicket, wave: ReadonlySet<number>): number[] => t.blockedBy.filter((b) => wave.has(b) && b !== t.n);

function findCycle(tickets: readonly PlanTicket[]): number[] | null {
  const wave = new Set(tickets.map((t) => t.n));
  const deps = new Map(tickets.map((t) => [t.n, inWaveBlockers(t, wave)]));
  const state = new Map<number, "open" | "closed">();
  const path: number[] = [];
  const visit = (n: number): number[] | null => {
    if (state.get(n) === "closed") return null;
    if (state.get(n) === "open") return path.slice(path.indexOf(n));
    state.set(n, "open");
    path.push(n);
    for (const d of deps.get(n) ?? []) {
      const cycle = visit(d);
      if (cycle) return cycle;
    }
    path.pop();
    state.set(n, "closed");
    return null;
  };
  for (const t of [...tickets].sort((a, b) => a.n - b.n)) {
    const cycle = visit(t.n);
    if (cycle) return cycle;
  }
  return null;
}

function groupByFiles(tickets: readonly PlanTicket[]): number[][] {
  const parent = new Map(tickets.map((t) => [t.n, t.n]));
  const root = (n: number): number => {
    const p = parent.get(n) ?? n;
    return p === n ? n : root(p);
  };
  const narrow = tickets.filter((t) => !t.wide);
  narrow.forEach((a, i) => {
    for (const b of narrow.slice(i + 1)) {
      if (shareFiles(a, b)) parent.set(root(b.n), root(a.n));
    }
  });
  const groups = new Map<number, number[]>();
  for (const t of tickets) {
    const key = t.wide ? t.n : root(t.n);
    groups.set(key, [...(groups.get(key) ?? []), t.n]);
  }
  return [...groups.values()].map((g) => g.sort(byNumber));
}

function dependencyOrder(tickets: readonly PlanTicket[]): Map<number, number> {
  const wave = new Set(tickets.map((t) => t.n));
  const left = new Map(tickets.map((t) => [t.n, new Set(inWaveBlockers(t, wave))]));
  const rank = new Map<number, number>();
  while (left.size) {
    const ready = [...left.keys()].filter((n) => [...(left.get(n) ?? [])].every((b) => rank.has(b))).sort(byNumber);
    const next = ready[0] ?? Math.min(...left.keys());
    rank.set(next, rank.size);
    left.delete(next);
  }
  return rank;
}

const orderTrack = (members: number[], rank: ReadonlyMap<number, number>): number[] => [...members].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));

export function nextBatch(s: Schedule): number[] {
  const byN = new Map(s.tickets.map((t) => [t.n, t]));
  const wave = new Set(byN.keys());
  const settled = (n: number) => s.done.has(n);
  const heads = s.tracks.flatMap((track) => {
    const left = track.tickets.filter((n) => !settled(n));
    const head = left[0];
    if (head === undefined || s.blocked.has(head)) return [];
    const ticket = byN.get(head);
    if (!ticket || !inWaveBlockers(ticket, wave).every(settled)) return [];
    return [{ ticket, left: left.length }];
  });
  const narrow = heads.filter((h) => !h.ticket.wide).sort((a, b) => b.left - a.left || a.ticket.n - b.ticket.n);
  if (narrow.length) return narrow.slice(0, s.max).map((h) => h.ticket.n);
  const narrowLeft = s.tickets.some((t) => !t.wide && !settled(t.n));
  if (narrowLeft) return [];
  const wide = heads.filter((h) => h.ticket.wide).sort((a, b) => a.ticket.n - b.ticket.n)[0];
  return wide ? [wide.ticket.n] : [];
}

export function planWave(tickets: readonly PlanTicket[], max: number): Either.Either<WavePlan, string> {
  if (!tickets.length) return Either.left("the wave has no tickets");
  const seen = new Set<number>();
  for (const t of tickets) {
    if (seen.has(t.n)) return Either.left(`ticket #${t.n} is listed twice`);
    seen.add(t.n);
  }
  const cycle = findCycle(tickets);
  if (cycle) return Either.left(`tickets ${cycle.map((n) => `#${n}`).join(", ")} block each other; break the loop before planning`);
  const rank = dependencyOrder(tickets);
  const notes = tickets.flatMap((t) =>
    t.blockedBy.filter((b) => !seen.has(b)).map((b) => `#${t.n} is blocked by #${b}, which is not in this wave: treated as done`),
  );
  const groups = groupByFiles(tickets).sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
  const tracks = groups.map((g, i) => ({ id: `${TRACK_PREFIX}${i + 1}`, tickets: orderTrack(g, rank) }));
  const done = new Set<number>();
  const batches: number[][] = [];
  while (done.size < tickets.length) {
    const batch = nextBatch({ tracks, tickets, done, blocked: new Set(), max });
    if (!batch.length) return Either.left("no ticket can start: check the blocked-by links");
    batches.push(batch);
    for (const n of batch) done.add(n);
  }
  return Either.right({ tracks, batches, notes });
}
