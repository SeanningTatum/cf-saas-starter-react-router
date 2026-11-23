import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Either } from "effect";
import { ghSpawn, type GhRunner } from "./lib/gh";
import {
  BRANCH_PATTERN,
  CONFLICTING,
  DEFAULT_WAIT_SECONDS,
  EXIT_BAD_INPUT,
  EXIT_GH,
  EXIT_OK,
  EXIT_USAGE,
  LOG_TAIL_LINES,
  MAX_REVIEW_ROUNDS,
  MAX_TRACKS_AT_ONCE,
  MAX_WAIT_SECONDS,
  MESSAGE_PREFIX,
  MS_PER_SECOND,
  POLL_SECONDS,
  SHA_PATTERN,
  SLUG_PATTERN,
  STATE_FILE_NAME,
  USAGE_TEXT,
  VERB_APPROVE,
  VERB_EVENT,
  VERB_GATE,
  VERB_GUARD,
  VERB_MERGE,
  VERB_NEXT,
  VERB_PAUSE,
  VERB_PLAN,
  VERB_RESUME,
  VERB_RETRY,
  VERB_ROLLUP,
  VERB_SKIP,
  VERB_STATUS,
  VERIFY_DIR,
  WAVE_STATE_VERSION,
} from "./lib/wave-constants";
import { mergePr, readGuard, type GuardResult } from "./lib/wave-guard";
import { planWave } from "./lib/wave-plan";
import { outLine, rollupBody, statusLines } from "./lib/wave-report";
import { decodeEvent, decodePlanInput, decodeState, newTicket, ticketOf, type WaveState, withLog, withTicket } from "./lib/wave-state";
import { type PersonChange, pause, resume, retry, skip } from "./lib/wave-person";
import { afterMerge, applyEvent, applyGate, applyGuard, nextWaveStep, viewOf } from "./lib/wave-step";

export interface Deps {
  root: string;
  readStdin: () => string;
  readFile: (path: string) => string | null;
  writeFile: (path: string, text: string) => void;
  mkdirp: (path: string) => void;
  gh: GhRunner;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export interface Outcome {
  code: number;
  stdout: string[];
  stderr: string[];
}

const done = (...stdout: string[]): Outcome => ({ code: EXIT_OK, stdout, stderr: [] });
const fail = (why: string, code = EXIT_BAD_INPUT): Outcome => ({ code, stdout: [], stderr: [`${MESSAGE_PREFIX} ${why}`] });
const usage = (why: string): Outcome => ({ code: EXIT_USAGE, stdout: [], stderr: [`${MESSAGE_PREFIX} ${why}`, USAGE_TEXT] });

const statePath = (deps: Deps, slug: string) => join(deps.root, VERIFY_DIR, slug, STATE_FILE_NAME);

function load(deps: Deps, slug: string): Either.Either<WaveState, string> {
  const text = deps.readFile(statePath(deps, slug));
  if (text === null) return Either.left(`no wave state for ${slug}: the workflow writes it at its plan step`);
  return Either.mapLeft(decodeState(text), (why) => `${statePath(deps, slug)} is not a wave state (${why})`);
}

function save(deps: Deps, state: WaveState): void {
  deps.mkdirp(join(deps.root, VERIFY_DIR, state.slug));
  deps.writeFile(statePath(deps, state.slug), `${JSON.stringify(state, null, 2)}\n`);
}

function parseFlags(args: string[]): { positional: string[]; flags: Map<string, string> } | string {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--json") flags.set(arg, "true");
    else if (arg.startsWith("--")) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) return `${arg} needs a value`;
      flags.set(arg, value);
      i++;
    } else positional.push(arg);
  }
  return { positional, flags };
}

const intFlag = (flags: Map<string, string>, name: string, min: number, max: number, dflt?: number): number | string => {
  const raw = flags.get(name);
  if (raw === undefined) return dflt ?? `${name} is required`;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : `${name} must be a whole number from ${min} to ${max}, got "${raw}"`;
};

function plan(deps: Deps, slug: string, flags: Map<string, string>): Outcome {
  const wave = flags.get("--wave") ?? "";
  const into = flags.get("--into") ?? "";
  if (!BRANCH_PATTERN.test(wave) || !BRANCH_PATTERN.test(into)) return usage("--wave and --into must be branch names");
  if (wave === into) return fail("the wave branch and the roll-up base must differ");
  const tracks = intFlag(flags, "--tracks", 1, MAX_TRACKS_AT_ONCE);
  const rounds = intFlag(flags, "--review-rounds", 0, MAX_REVIEW_ROUNDS);
  if (typeof tracks === "string") return usage(tracks);
  if (typeof rounds === "string") return usage(rounds);
  const before = deps.readFile(statePath(deps, slug)) === null ? null : load(deps, slug);
  if (before && Either.isRight(before) && before.right.planApproved)
    return fail("the plan is approved and cannot change; edit the state with retry or skip instead");
  const input = decodePlanInput(deps.readStdin());
  if (Either.isLeft(input)) return fail(`plan input: ${input.left}`);
  const made = planWave(input.right.tickets, tracks);
  if (Either.isLeft(made)) return fail(made.left);
  const trackOf = new Map(made.right.tracks.flatMap((t) => t.tickets.map((n) => [n, t.id] as const)));
  const state: WaveState = {
    version: WAVE_STATE_VERSION,
    slug,
    wave,
    into,
    tracksAtOnce: tracks,
    reviewRounds: rounds,
    paused: false,
    planApproved: false,
    planChanges: input.right.changes,
    notes: made.right.notes,
    tracks: made.right.tracks,
    projected: made.right.batches,
    tickets: input.right.tickets.map((t) => newTicket(t, trackOf.get(t.n) ?? "")),
    batch: null,
    batchesDone: 0,
    failures: [],
    halt: null,
    rollupPr: null,
    log: [`planned ${input.right.tickets.length} tickets in ${made.right.tracks.length} tracks and ${made.right.batches.length} batches`],
  };
  save(deps, state);
  return done(outLine({ tracks: made.right.tracks, batches: made.right.batches, notes: made.right.notes }));
}

async function waitGuard(deps: Deps, pr: number, wave: string, waitSeconds: number): Promise<Either.Either<GuardResult, string>> {
  const start = deps.now();
  for (;;) {
    const read = readGuard(deps.gh, pr, wave);
    if (Either.isLeft(read) || read.right.verdict !== "pending") return read;
    if ((deps.now() - start) / MS_PER_SECOND + POLL_SECONDS > waitSeconds) return read;
    await deps.sleep(POLL_SECONDS * MS_PER_SECOND);
  }
}

const ticketOut = (state: WaveState, n: number, extra: Record<string, unknown> = {}) => {
  const t = ticketOf(state, n);
  return outLine({ ticket: t ? viewOf(t, state.reviewRounds) : null, halt: state.halt, paused: state.paused, ...extra });
};

async function guard(deps: Deps, state: WaveState, n: number, flags: Map<string, string>): Promise<Outcome> {
  const t = ticketOf(state, n);
  if (!t || t.pr === null) return fail(`#${n} has no PR in this wave`);
  const wait = intFlag(flags, "--wait", 0, MAX_WAIT_SECONDS, DEFAULT_WAIT_SECONDS);
  if (typeof wait === "string") return usage(wait);
  const read = await waitGuard(deps, t.pr, state.wave, wait);
  if (Either.isLeft(read)) return fail(read.left, EXIT_GH);
  const next = applyGuard(state, n, read.right);
  save(deps, next);
  return done(ticketOut(next, n, { guard: read.right }));
}

function merge(deps: Deps, state: WaveState): Outcome {
  if (!state.batch) return fail("no batch is running");
  let next = state;
  const merged: number[] = [];
  const refused: { n: number; why: string }[] = [];
  for (const n of state.batch.tickets) {
    const t = ticketOf(next, n);
    if (t?.status !== "green" || t.pr === null) continue;
    const read = readGuard(deps.gh, t.pr, state.wave);
    if (Either.isLeft(read)) return fail(read.left, EXIT_GH);
    if (read.right.verdict !== "green") {
      next = applyGuard(
        withTicket(next, n, () => ({ status: "open" })),
        n,
        read.right,
      );
      continue;
    }
    if (read.right.mergeable === CONFLICTING) {
      refused.push({ n, why: "conflicts with the wave branch" });
      continue;
    }
    const result = mergePr(deps.gh, t.pr, read.right.head);
    if (Either.isRight(result)) merged.push(n);
    else refused.push({ n, why: result.left });
  }
  next = afterMerge(next, merged, refused);
  save(deps, next);
  return done(outLine({ merged, refused, halt: next.halt, paused: next.paused }));
}

function gate(deps: Deps, state: WaveState, flags: Map<string, string>): Outcome {
  const head = flags.get("--head") ?? "";
  if (!SHA_PATTERN.test(head)) return usage("--head must be a full commit sha");
  const code = intFlag(flags, "--code", 0, Number.MAX_SAFE_INTEGER);
  if (typeof code === "string") return usage(code);
  const logPath = flags.get("--log") ?? "";
  const tail = logPath ? (deps.readFile(logPath) ?? "").trimEnd().split("\n").slice(-LOG_TAIL_LINES).join("\n") : "";
  const next = applyGate(state, head, code, logPath);
  save(deps, next);
  return done(outLine({ gate: code === 0 ? "pass" : "fail", failures: next.batch?.gateFailures ?? 0, tail }));
}

function rollup(deps: Deps, state: WaveState, flags: Map<string, string>): Outcome {
  const title = flags.get("--title") ?? "";
  if (!title.trim()) return usage("--title is required");
  const open = deps.gh(["pr", "list", "--head", state.wave, "--base", state.into, "--state", "open", "--json", "number", "-q", ".[0].number"]);
  if (open.code !== 0) return fail(`gh pr list: ${open.stderr.trim()}`, EXIT_GH);
  let pr = Number(open.stdout.trim());
  if (!Number.isInteger(pr) || pr <= 0) {
    const made = deps.gh(["pr", "create", "--base", state.into, "--head", state.wave, "--title", title, "--body-file", "-"], rollupBody(state));
    if (made.code !== 0) return fail(`gh pr create: ${made.stderr.trim()}`, EXIT_GH);
    pr = Number(made.stdout.trim().split("/").pop());
    if (!Number.isInteger(pr) || pr <= 0) return fail(`gh pr create printed no PR url: ${made.stdout.trim()}`, EXIT_GH);
  }
  const next = withLog({ ...state, rollupPr: pr }, `roll-up PR #${pr} open; the run never merges it`);
  save(deps, next);
  return done(outLine({ pr }));
}

const person = (deps: Deps, change: Either.Either<PersonChange, string>): Outcome => {
  if (Either.isLeft(change)) return fail(change.left);
  save(deps, change.right.state);
  return done(`${MESSAGE_PREFIX} ${change.right.message}`);
};

type Handler = (deps: Deps, state: WaveState, ticket: number | null, flags: Map<string, string>) => Outcome | Promise<Outcome>;

const needTicket =
  (go: (deps: Deps, state: WaveState, n: number, flags: Map<string, string>) => Outcome | Promise<Outcome>): Handler =>
  (deps, state, ticket, flags) =>
    ticket === null || !Number.isInteger(ticket) ? usage("this verb needs a ticket number") : go(deps, state, ticket, flags);

function next(deps: Deps, state: WaveState): Outcome {
  const advanced = nextWaveStep(state);
  if (advanced.state !== state) save(deps, advanced.state);
  return done(outLine({ step: advanced.step }));
}

function event(deps: Deps, state: WaveState): Outcome {
  const decoded = decodeEvent(deps.readStdin());
  if (Either.isLeft(decoded)) return fail(`event: ${decoded.left}`);
  if (!ticketOf(state, decoded.right.n)) return fail(`#${decoded.right.n} is not in this wave`);
  const after = applyEvent(state, decoded.right);
  save(deps, after);
  return done(ticketOut(after, decoded.right.n));
}

const HANDLERS: Record<string, Handler> = {
  [VERB_APPROVE]: (deps, state) => {
    save(deps, withLog({ ...state, planApproved: true }, "plan approved"));
    return done(outLine({ approved: true }));
  },
  [VERB_NEXT]: (deps, state) => next(deps, state),
  [VERB_EVENT]: (deps, state) => event(deps, state),
  [VERB_GUARD]: needTicket(guard),
  [VERB_MERGE]: (deps, state) => merge(deps, state),
  [VERB_GATE]: (deps, state, _ticket, flags) => gate(deps, state, flags),
  [VERB_ROLLUP]: (deps, state, _ticket, flags) => rollup(deps, state, flags),
  [VERB_STATUS]: (_deps, state, _ticket, flags) => done(flags.has("--json") ? JSON.stringify(state) : statusLines(state).join("\n")),
  [VERB_PAUSE]: (deps, state) => person(deps, Either.right(pause(state))),
  [VERB_RESUME]: (deps, state) => person(deps, Either.right(resume(state))),
  [VERB_RETRY]: needTicket((deps, state, n) => person(deps, retry(state, n))),
  [VERB_SKIP]: needTicket((deps, state, n) => person(deps, skip(state, n))),
};

export async function run(argv: string[], deps: Deps): Promise<Outcome> {
  const [verb, slug, ...rest] = argv;
  if (!verb) return usage("a verb is required");
  if (!slug || !SLUG_PATTERN.test(slug)) return usage("<slug> must be lower-case words joined by dashes");
  const parsed = parseFlags(rest);
  if (typeof parsed === "string") return usage(parsed);
  if (verb === VERB_PLAN) return plan(deps, slug, parsed.flags);
  if (verb === VERB_NEXT && deps.readFile(statePath(deps, slug)) === null) return done(outLine({ step: { kind: "plan" } }));
  const handler = HANDLERS[verb];
  if (!handler) return usage(`unknown verb "${verb}"`);
  const loaded = load(deps, slug);
  if (Either.isLeft(loaded)) return fail(loaded.left);
  const first = parsed.positional[0];
  return handler(deps, loaded.right, first === undefined ? null : Number(first.replace(/^#/, "")), parsed.flags);
}

const readOrNull = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

export const defaultDeps = (root: string): Deps => ({
  root,
  readStdin: () => readFileSync(0, "utf8"),
  readFile: readOrNull,
  writeFile: (p, t) => writeFileSync(p, t),
  mkdirp: (p) => void mkdirSync(p, { recursive: true }),
  gh: ghSpawn,
  sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
  now: () => Date.now(),
});

if (import.meta.main) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const o = await run(process.argv.slice(2), defaultDeps(root));
  for (const l of o.stdout) console.log(l);
  for (const l of o.stderr) console.error(l);
  process.exit(o.code);
}
