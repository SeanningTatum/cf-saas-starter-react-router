import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Either } from "effect";
import { ghSpawn, type GhRunner } from "./lib/gh";
import { WAVE_MAX_REVIEW_ROUNDS, WAVE_MAX_TRACKS } from "./lib/harness-config-constants";
import {
  BRANCH_PATTERN,
  CONFLICTING,
  DATE_LENGTH,
  DEFAULT_WAIT_SECONDS,
  EXIT_BAD_INPUT,
  EXIT_GH,
  EXIT_OK,
  EXIT_USAGE,
  LOCK_SUFFIX,
  LOCK_TRIES,
  LOCK_WAIT_MS,
  LOG_TAIL_LINES,
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
  VERB_MERGED,
  VERB_NEXT,
  VERB_PAUSE,
  VERB_PLAN,
  VERB_RESUME,
  VERB_RETRY,
  VERB_ROLLUP,
  VERB_SKIP,
  VERB_STATUS,
  VERIFY_DIR,
} from "./lib/wave-constants";
import { mergePr, readGuard, type GuardResult } from "./lib/wave-guard";
import { planWave } from "./lib/wave-plan";
import { mergeRollupBody, outLine, rollupBody, statusLines } from "./lib/wave-report";
import { decodeEvent, decodeOpenPrs, decodePlanInput, decodeState, newWave, ticketOf, type WaveState, withLog, withTicket } from "./lib/wave-state";
import { type PersonChange, pause, resume, retry, skip } from "./lib/wave-person";
import { afterMerge, applyEvent, applyGate, applyGuard, nextWaveStep, viewOf } from "./lib/wave-step";

export interface Deps {
  root: string;
  readStdin: () => string;
  readFile: (path: string) => string | null;
  writeFile: (path: string, text: string) => void;
  mkdirp: (path: string) => void;
  createExclusive: (path: string, text: string) => boolean;
  remove: (path: string) => void;
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
  deps.writeFile(statePath(deps, state.slug), `${JSON.stringify(state, null, 2)}\n`);
}

async function withLock<T>(deps: Deps, slug: string, fn: () => T): Promise<Either.Either<T, string>> {
  deps.mkdirp(join(deps.root, VERIFY_DIR, slug));
  const lock = `${statePath(deps, slug)}${LOCK_SUFFIX}`;
  for (let i = 0; !deps.createExclusive(lock, String(deps.now())); i++) {
    if (i >= LOCK_TRIES) return Either.left(`the wave state is locked by another step (${lock}); if no wave step is running, delete that file`);
    await deps.sleep(LOCK_WAIT_MS);
  }
  try {
    return Either.right(fn());
  } finally {
    deps.remove(lock);
  }
}

async function commit<T>(deps: Deps, slug: string, change: (fresh: WaveState) => { state: WaveState; value: T }): Promise<Either.Either<T, string>> {
  const result = await withLock(deps, slug, () =>
    Either.map(load(deps, slug), (fresh) => {
      const changed = change(fresh);
      if (changed.state !== fresh) save(deps, changed.state);
      return changed.value;
    }),
  );
  return Either.flatMap(result, (inner) => inner);
}

const settle = <T>(result: Either.Either<T, string>, show: (value: T) => string): Outcome =>
  Either.isLeft(result) ? fail(result.left) : done(show(result.right));

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

async function plan(deps: Deps, slug: string, flags: Map<string, string>): Promise<Outcome> {
  const wave = flags.get("--wave") ?? "";
  const into = flags.get("--into") ?? "";
  if (!BRANCH_PATTERN.test(wave) || !BRANCH_PATTERN.test(into)) return usage("--wave and --into must be branch names");
  if (wave === into) return fail("the wave branch and the roll-up base must differ");
  const tracks = intFlag(flags, "--tracks", 1, WAVE_MAX_TRACKS);
  const rounds = intFlag(flags, "--review-rounds", 0, WAVE_MAX_REVIEW_ROUNDS);
  if (typeof tracks === "string") return usage(tracks);
  if (typeof rounds === "string") return usage(rounds);
  const input = decodePlanInput(deps.readStdin());
  if (Either.isLeft(input)) return fail(`plan input: ${input.left}`);
  const made = planWave(input.right.tickets, tracks);
  if (Either.isLeft(made)) return fail(made.left);
  const written = await withLock(deps, slug, () => {
    const before = deps.readFile(statePath(deps, slug)) === null ? null : load(deps, slug);
    if (before && Either.isRight(before) && before.right.planApproved) return false;
    save(deps, newWave({ slug, wave, into, tracksAtOnce: tracks, reviewRounds: rounds, plan: made.right, tickets: input.right.tickets }));
    return true;
  });
  if (Either.isLeft(written)) return fail(written.left);
  if (!written.right) return fail("the plan is approved and cannot change; edit the state with retry or skip instead");
  return done(outLine({ tracks: made.right.tracks, batches: made.right.batches, notes: made.right.notes }));
}

async function waitGuard(deps: Deps, pr: number, wave: string, branch: string, waitSeconds: number): Promise<Either.Either<GuardResult, string>> {
  const start = deps.now();
  for (;;) {
    const read = readGuard(deps.gh, pr, wave, branch);
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
  const read = await waitGuard(deps, t.pr, state.wave, t.branch, wait);
  if (Either.isLeft(read)) return fail(read.left, EXIT_GH);
  const guarded = read.right;
  const saved = await commit(deps, state.slug, (fresh) => {
    const after = applyGuard(fresh, n, guarded);
    return { state: after, value: ticketOut(after, n, { guard: guarded }) };
  });
  return settle(saved, (line) => line);
}

async function merge(deps: Deps, state: WaveState): Promise<Outcome> {
  if (!state.batch) return fail("no batch is running");
  const reopened: { n: number; guard: GuardResult }[] = [];
  const merged: number[] = [];
  const refused: { n: number; why: string }[] = [];
  for (const n of state.batch.tickets) {
    const t = ticketOf(state, n);
    if (t?.status !== "green" || t.pr === null) continue;
    const read = readGuard(deps.gh, t.pr, state.wave, t.branch);
    if (Either.isLeft(read)) return fail(read.left, EXIT_GH);
    if (read.right.verdict !== "green") {
      reopened.push({ n, guard: read.right });
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
  const saved = await commit(deps, state.slug, (fresh) => {
    const guarded = reopened.reduce(
      (s, r) =>
        applyGuard(
          withTicket(s, r.n, () => ({ status: "open" })),
          r.n,
          r.guard,
        ),
      fresh,
    );
    const after = afterMerge(guarded, merged, refused);
    return { state: after, value: outLine({ merged, refused, halt: after.halt, paused: after.paused }) };
  });
  return settle(saved, (line) => line);
}

const mergedOf = (state: WaveState): number[] => (state.batch?.tickets ?? []).filter((n) => ticketOf(state, n)?.status === "merged");

async function gate(deps: Deps, state: WaveState, flags: Map<string, string>): Promise<Outcome> {
  const head = flags.get("--head") ?? "";
  if (!SHA_PATTERN.test(head)) return usage("--head must be a full commit sha");
  const code = intFlag(flags, "--code", 0, Number.MAX_SAFE_INTEGER);
  if (typeof code === "string") return usage(code);
  const logPath = flags.get("--log") ?? "";
  const ownDir = join(deps.root, VERIFY_DIR, state.slug);
  if (logPath && !resolve(logPath).startsWith(`${ownDir}/`)) return usage(`--log must name a file under ${ownDir}`);
  const tail = logPath ? (deps.readFile(logPath) ?? "").trimEnd().split("\n").slice(-LOG_TAIL_LINES).join("\n") : "";
  const saved = await commit(deps, state.slug, (fresh) => {
    const after = applyGate(fresh, head, code, logPath);
    return { state: after, value: outLine({ gate: code === 0 ? "pass" : "fail", failures: after.batch?.gateFailures ?? 0, tail, merged: mergedOf(after) }) };
  });
  return settle(saved, (line) => line);
}

async function readSize(deps: Deps, slug: string, flags: Map<string, string>): Promise<Either.Either<string, Outcome>> {
  const path = flags.get("--size-file");
  if (path === undefined) return Either.right("");
  const ownDir = join(deps.root, VERIFY_DIR, slug);
  if (!resolve(path).startsWith(`${ownDir}/`)) return Either.left(usage(`--size-file must name a file under ${ownDir}`));
  const text = deps.readFile(path);
  return text === null ? Either.left(fail(`--size-file ${path} does not exist`)) : Either.right(text);
}

const editRollup = (deps: Deps, pr: number, body: string): Either.Either<number, Outcome> => {
  const edited = deps.gh(["pr", "edit", String(pr), "--body-file", "-"], body);
  return edited.code === 0 ? Either.right(pr) : Either.left(fail(`gh pr edit: ${edited.stderr.trim()}`, EXIT_GH));
};

function createRollup(deps: Deps, state: WaveState, title: string, body: string): Either.Either<number, Outcome> {
  const made = deps.gh(["pr", "create", "--base", state.into, "--head", state.wave, "--title", title, "--body-file", "-"], body);
  if (made.code !== 0) return Either.left(fail(`gh pr create: ${made.stderr.trim()}`, EXIT_GH));
  const pr = Number(made.stdout.trim().split("/").pop());
  if (!Number.isInteger(pr) || pr <= 0) return Either.left(fail(`gh pr create printed no PR url: ${made.stdout.trim()}`, EXIT_GH));
  return Either.right(pr);
}

async function rollup(deps: Deps, state: WaveState, flags: Map<string, string>): Promise<Outcome> {
  const title = flags.get("--title") ?? "";
  if (!title.trim()) return usage("--title is required");
  const size = await readSize(deps, state.slug, flags);
  if (Either.isLeft(size)) return size.left;
  const open = deps.gh(["pr", "list", "--head", state.wave, "--base", state.into, "--state", "open", "--json", "number,body"]);
  if (open.code !== 0) return fail(`gh pr list: ${open.stderr.trim()}`, EXIT_GH);
  const found = decodeOpenPrs(open.stdout);
  if (Either.isLeft(found)) return fail(`gh pr list printed something else than PRs: ${found.left}`, EXIT_GH);
  const existing = found.right[0];
  const date = new Date(deps.now()).toISOString().slice(0, DATE_LENGTH);
  const published = existing
    ? editRollup(deps, existing.number, mergeRollupBody(existing.body ?? "", state, date, size.right))
    : createRollup(deps, state, title, rollupBody(state, size.right));
  if (Either.isLeft(published)) return published.left;
  const opened = published.right;
  const saved = await commit(deps, state.slug, (fresh) => ({
    state: withLog({ ...fresh, rollupPr: opened }, `roll-up PR #${opened} ${existing ? "updated" : "open"}; the run never merges it`),
    value: outLine({ pr: opened }),
  }));
  return settle(saved, (line) => line);
}

const person = async (deps: Deps, slug: string, change: (fresh: WaveState) => Either.Either<PersonChange, string>): Promise<Outcome> => {
  const saved = await commit<Either.Either<PersonChange, string>>(deps, slug, (fresh) => {
    const c = change(fresh);
    return { state: Either.isRight(c) ? c.right.state : fresh, value: c };
  });
  const flat = Either.flatMap(saved, (c) => c);
  return Either.isLeft(flat) ? fail(flat.left) : done(`${MESSAGE_PREFIX} ${flat.right.message}`);
};

type Handler = (deps: Deps, state: WaveState, ticket: number | null, flags: Map<string, string>) => Outcome | Promise<Outcome>;

const needTicket =
  (go: (deps: Deps, state: WaveState, n: number, flags: Map<string, string>) => Outcome | Promise<Outcome>): Handler =>
  (deps, state, ticket, flags) =>
    ticket === null || !Number.isInteger(ticket) ? usage("this verb needs a ticket number") : go(deps, state, ticket, flags);

async function next(deps: Deps, state: WaveState): Promise<Outcome> {
  const saved = await commit(deps, state.slug, (fresh) => {
    const advanced = nextWaveStep(fresh);
    return { state: advanced.state, value: outLine({ step: advanced.step }) };
  });
  return settle(saved, (line) => line);
}

async function event(deps: Deps, state: WaveState): Promise<Outcome> {
  const decoded = decodeEvent(deps.readStdin());
  if (Either.isLeft(decoded)) return fail(`event: ${decoded.left}`);
  const e = decoded.right;
  if (!ticketOf(state, e.n)) return fail(`#${e.n} is not in this wave`);
  const saved = await commit(deps, state.slug, (fresh) => {
    const after = applyEvent(fresh, e);
    return { state: after, value: ticketOut(after, e.n) };
  });
  return settle(saved, (line) => line);
}

const HANDLERS: Record<string, Handler> = {
  [VERB_APPROVE]: async (deps, state) =>
    settle(
      await commit(deps, state.slug, (fresh) => ({ state: withLog({ ...fresh, planApproved: true }, "plan approved"), value: outLine({ approved: true }) })),
      (line) => line,
    ),
  [VERB_NEXT]: (deps, state) => next(deps, state),
  [VERB_EVENT]: (deps, state) => event(deps, state),
  [VERB_GUARD]: needTicket(guard),
  [VERB_MERGE]: (deps, state) => merge(deps, state),
  [VERB_MERGED]: (_deps, state) => done(outLine({ merged: state.tickets.filter((t) => t.status === "merged").map((t) => t.n) })),
  [VERB_GATE]: (deps, state, _ticket, flags) => gate(deps, state, flags),
  [VERB_ROLLUP]: (deps, state, _ticket, flags) => rollup(deps, state, flags),
  [VERB_STATUS]: (_deps, state, _ticket, flags) => done(flags.has("--json") ? JSON.stringify(state) : statusLines(state).join("\n")),
  [VERB_PAUSE]: (deps, state) => person(deps, state.slug, (fresh) => Either.right(pause(fresh))),
  [VERB_RESUME]: (deps, state) => person(deps, state.slug, (fresh) => Either.right(resume(fresh))),
  [VERB_RETRY]: needTicket((deps, state, n) => person(deps, state.slug, (fresh) => retry(fresh, n))),
  [VERB_SKIP]: needTicket((deps, state, n) => person(deps, state.slug, (fresh) => skip(fresh, n))),
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
  createExclusive: (p, t) => {
    try {
      writeFileSync(p, t, { flag: "wx" });
      return true;
    } catch {
      return false;
    }
  },
  remove: (p) => rmSync(p, { force: true }),
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
