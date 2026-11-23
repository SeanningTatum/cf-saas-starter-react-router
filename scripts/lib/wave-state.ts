import { Either, ParseResult, Schema } from "effect";
import { WAVE_MAX_REVIEW_ROUNDS, WAVE_MAX_TRACKS } from "./harness-config-constants";
import {
  BRANCH_PATTERN,
  FIX_KINDS,
  GATE_RESULTS,
  MAX_LIST,
  MAX_TEXT,
  MAX_TICKETS,
  SLUG_PATTERN,
  TICKET_KINDS,
  TICKET_STATUSES,
  WAVE_STATE_VERSION,
} from "./wave-constants";

const Text = Schema.String.pipe(Schema.maxLength(MAX_TEXT));
const Texts = Schema.Array(Text).pipe(Schema.maxItems(MAX_LIST));
const TicketNumber = Schema.Int.pipe(Schema.positive());
const Count = Schema.NonNegativeInt;
const Branch = Schema.String.pipe(Schema.pattern(BRANCH_PATTERN));
const Kind = Schema.Literal(...TICKET_KINDS);

const PlanTicketSchema = Schema.Struct({
  n: TicketNumber,
  title: Text,
  kind: Kind,
  blockedBy: Schema.Array(TicketNumber).pipe(Schema.maxItems(MAX_LIST)),
  files: Texts,
  wide: Schema.Boolean,
});

const PlanInputSchema = Schema.Struct({
  tickets: Schema.Array(PlanTicketSchema).pipe(Schema.minItems(1), Schema.maxItems(MAX_TICKETS)),
});

const TicketSchema = Schema.extend(
  PlanTicketSchema,
  Schema.Struct({
    track: Text,
    status: Schema.Literal(...TICKET_STATUSES),
    batch: Schema.NullOr(Count),
    pr: Schema.NullOr(TicketNumber),
    branch: Schema.String,
    head: Schema.String,
    reviewed: Count,
    reviewBlocking: Schema.Boolean,
    findings: Texts,
    needsFix: Schema.Boolean,
    checkFailures: Count,
    needsCheckFix: Schema.Boolean,
    threadRounds: Count,
    needsThreads: Schema.Boolean,
    pendingRounds: Count,
    refresh: Schema.Boolean,
    mergeRefusals: Count,
    why: Text,
    ownerSteps: Texts,
  }),
);

const BatchSchema = Schema.Struct({
  index: Count,
  tickets: Schema.Array(TicketNumber),
  gate: Schema.Literal(...GATE_RESULTS),
  gateFailures: Count,
  gateLog: Text,
  closed: Schema.Boolean,
});

const FailureSchema = Schema.Struct({ n: TicketNumber, track: Text, signature: Text });

const WaveStateSchema = Schema.Struct({
  version: Schema.Literal(WAVE_STATE_VERSION),
  slug: Schema.String.pipe(Schema.pattern(SLUG_PATTERN)),
  wave: Branch,
  into: Branch,
  tracksAtOnce: Schema.Int.pipe(Schema.between(1, WAVE_MAX_TRACKS)),
  reviewRounds: Schema.Int.pipe(Schema.between(0, WAVE_MAX_REVIEW_ROUNDS)),
  paused: Schema.Boolean,
  planApproved: Schema.Boolean,
  notes: Texts,
  tracks: Schema.Array(Schema.Struct({ id: Text, tickets: Schema.Array(TicketNumber) })),
  projected: Schema.Array(Schema.Array(TicketNumber)),
  tickets: Schema.Array(TicketSchema),
  batch: Schema.NullOr(BatchSchema),
  batchesDone: Count,
  failures: Schema.Array(FailureSchema),
  halt: Schema.NullOr(Schema.Struct({ signature: Text, tickets: Schema.Array(TicketNumber) })),
  rollupPr: Schema.NullOr(TicketNumber),
  log: Schema.Array(Text),
});

const EventSchema = Schema.Union(
  Schema.Struct({ type: Schema.Literal("opened"), n: TicketNumber, pr: TicketNumber, branch: Branch, head: Text, ownerSteps: Texts }),
  Schema.Struct({ type: Schema.Literal("failed"), n: TicketNumber, line: Text }),
  Schema.Struct({ type: Schema.Literal("reviewed"), n: TicketNumber, blocking: Texts }),
  Schema.Struct({
    type: Schema.Literal("fixed"),
    n: TicketNumber,
    what: Schema.Literal(...FIX_KINDS),
    head: Text,
    cause: Schema.optionalWith(Text, { default: () => "" }),
  }),
);

export type PlanTicketInput = typeof PlanTicketSchema.Type;
export type Ticket = typeof TicketSchema.Type;
export type Batch = typeof BatchSchema.Type;
export type WaveState = typeof WaveStateSchema.Type;
export type WaveEvent = typeof EventSchema.Type;
export type FixKind = (typeof FIX_KINDS)[number];

const firstIssue = (error: ParseResult.ParseError): string => {
  const issue = ParseResult.ArrayFormatter.formatErrorSync(error)[0];
  if (!issue) return "invalid input";
  const key = issue.path.map(String).join(".");
  return key ? `${key}: ${issue.message}` : issue.message;
};

const decoder =
  <A, I>(schema: Schema.Schema<A, I>) =>
  (text: string): Either.Either<A, string> =>
    Either.mapLeft(Schema.decodeUnknownEither(Schema.parseJson(schema), { onExcessProperty: "error", errors: "first" })(text), firstIssue);

export const decodeState = decoder(WaveStateSchema);
export const decodePlanInput = decoder(PlanInputSchema);
export const decodeEvent = decoder(EventSchema);

export const newTicket = (t: PlanTicketInput, track: string): Ticket => ({
  ...t,
  track,
  status: "queued",
  batch: null,
  pr: null,
  branch: "",
  head: "",
  reviewed: 0,
  reviewBlocking: false,
  findings: [],
  needsFix: false,
  checkFailures: 0,
  needsCheckFix: false,
  threadRounds: 0,
  needsThreads: false,
  pendingRounds: 0,
  refresh: false,
  mergeRefusals: 0,
  why: "",
  ownerSteps: [],
});

export interface WaveSetup {
  slug: string;
  wave: string;
  into: string;
  tracksAtOnce: number;
  reviewRounds: number;
  plan: { tracks: { id: string; tickets: number[] }[]; batches: number[][]; notes: string[] };
  tickets: readonly PlanTicketInput[];
}

export function newWave(s: WaveSetup): WaveState {
  const trackOf = new Map(s.plan.tracks.flatMap((t) => t.tickets.map((n) => [n, t.id] as const)));
  return {
    version: WAVE_STATE_VERSION,
    slug: s.slug,
    wave: s.wave,
    into: s.into,
    tracksAtOnce: s.tracksAtOnce,
    reviewRounds: s.reviewRounds,
    paused: false,
    planApproved: false,
    notes: s.plan.notes,
    tracks: s.plan.tracks,
    projected: s.plan.batches,
    tickets: s.tickets.map((t) => newTicket(t, trackOf.get(t.n) ?? "")),
    batch: null,
    batchesDone: 0,
    failures: [],
    halt: null,
    rollupPr: null,
    log: [`planned ${s.tickets.length} tickets in ${s.plan.tracks.length} tracks and ${s.plan.batches.length} batches`],
  };
}

export const newBatch = (index: number, tickets: number[]): Batch => ({
  index,
  tickets,
  gate: "",
  gateFailures: 0,
  gateLog: "",
  closed: false,
});

export const ticketOf = (state: WaveState, n: number): Ticket | undefined => state.tickets.find((t) => t.n === n);

export const withTicket = (state: WaveState, n: number, change: (t: Ticket) => Partial<Ticket>): WaveState => ({
  ...state,
  tickets: state.tickets.map((t) => (t.n === n ? { ...t, ...change(t) } : t)),
});

export const withLog = (state: WaveState, line: string): WaveState => ({ ...state, log: [...state.log, line.slice(0, MAX_TEXT)] });
