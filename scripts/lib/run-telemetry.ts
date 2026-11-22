import { join } from "node:path";
import { Either, Option, Schema } from "effect";
import {
  AGENT_FILE_PREFIX,
  AGENT_ID_PATTERN,
  BOOLEAN_VERDICT_KEYS,
  CALL_FIELD_COUNT,
  CHECKSUM_DIGITS,
  FIELD_MAX_LENGTH,
  FIRST_ATTEMPT,
  FNV_OFFSET_BASIS,
  FNV_PRIME,
  HEX_RADIX,
  LEDGER_TEXT_FIELDS,
  META_SUFFIX,
  MS_PER_SECOND,
  OUTCOMES,
  OUTCOME_EMPTY,
  OUTCOME_OK,
  RUN_FILE_VERSION,
  SLUG_PATTERN,
  TRANSCRIPT_SUFFIX,
  VERDICT_FAIL,
  VERDICT_PASS,
} from "./run-telemetry-constants";

const Text = Schema.String.pipe(Schema.maxLength(FIELD_MAX_LENGTH));
const Slug = Schema.String.pipe(Schema.pattern(SLUG_PATTERN));
const Attempt = Schema.Int.pipe(Schema.greaterThanOrEqualTo(FIRST_ATTEMPT));
const CallOutcome = Schema.Literal(...OUTCOMES);

const TokensSchema = Schema.Struct({
  in: Schema.NonNegativeInt,
  out: Schema.NonNegativeInt,
  cache_read: Schema.NonNegativeInt,
  cache_write: Schema.NonNegativeInt,
});

const LedgerCallSchema = Schema.Struct({
  label: Text,
  phase: Text,
  agent: Text,
  model: Text,
  attempt: Attempt,
  outcome: CallOutcome,
  verdict: Text,
});

const CallSchema = Schema.extend(
  LedgerCallSchema,
  Schema.Struct({
    n: Schema.NonNegativeInt,
    tokens: Schema.NullOr(TokensSchema),
    seconds: Schema.NullOr(Schema.Number),
    ran_model: Schema.NullOr(Text),
  }),
);

const RunFileSchema = Schema.Struct({
  version: Schema.Literal(RUN_FILE_VERSION),
  slug: Slug,
  workflows: Schema.Record({ key: Schema.String, value: Schema.Struct({ calls: Schema.Array(CallSchema) }) }),
});

const hasSlugWorkflowNames = (raw: unknown): boolean =>
  typeof raw !== "object" ||
  raw === null ||
  !("workflows" in raw) ||
  typeof raw.workflows !== "object" ||
  raw.workflows === null ||
  Object.keys(raw.workflows).every((name) => SLUG_PATTERN.test(name));

const RawRunFile = Schema.parseJson(
  Schema.Unknown.pipe(Schema.filter(hasSlugWorkflowNames, { message: () => "every workflow name must be lower-case words joined by dashes" })),
);

const LedgerLine = Schema.Tuple(Schema.String, Schema.String, Schema.String, Schema.String, Attempt, CallOutcome, Schema.String);
const Footer = Schema.Struct({ calls: Schema.NonNegativeInt, check: Schema.String });

export type LedgerCall = typeof LedgerCallSchema.Type;
export type Call = typeof CallSchema.Type;
export type RunFile = typeof RunFileSchema.Type;
type Tokens = typeof TokensSchema.Type;

const squash = (text: string) => text.replace(/\s+/g, " ").trim();
const decodeLoose = <A, I>(schema: Schema.Schema<A, I>) => Schema.decodeUnknownOption(Schema.parseJson(schema));

export const isValidSlug = (text: string): boolean => SLUG_PATTERN.test(text);

export function ledgerChecksum(text: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(HEX_RADIX).padStart(CHECKSUM_DIGITS, "0");
}

function parseCallLine(line: string, position: number): LedgerCall | string {
  const where = `call line ${position + 1}`;
  const array = Schema.decodeUnknownEither(Schema.parseJson(Schema.Array(Schema.Unknown)))(line);
  if (Either.isLeft(array)) return `${where} is not a JSON array`;
  if (array.right.length !== CALL_FIELD_COUNT) return `${where} has ${array.right.length} fields, not ${CALL_FIELD_COUNT}`;
  const fields = Schema.decodeUnknownEither(LedgerLine)(array.right);
  if (Either.isLeft(fields)) {
    return `${where}: label, phase, agent, model and verdict must be strings, attempt a whole number from ${FIRST_ATTEMPT} up, outcome one of ${OUTCOMES.join(", ")}`;
  }
  const [label, phase, agent, model, attempt, outcome, verdict] = fields.right;
  const entry: LedgerCall = { label, phase, agent, model, attempt, outcome, verdict };
  const tooLong = LEDGER_TEXT_FIELDS.find((name) => entry[name].length > FIELD_MAX_LENGTH);
  return tooLong === undefined ? entry : `${where}: ${tooLong} is longer than ${FIELD_MAX_LENGTH} characters`;
}

export function parseLedger(text: string): { calls: LedgerCall[] } | { error: string } {
  const lines = text.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const footerLine = lines.pop();
  if (footerLine === undefined) return { error: "no ledger on stdin" };
  const footer = decodeLoose(Footer)(footerLine);
  if (Option.isNone(footer)) return { error: 'the last line must be {"calls":<number>,"check":<text>}' };
  if (footer.value.calls !== lines.length) return { error: `the footer counts ${footer.value.calls} calls but ${lines.length} came` };
  if (footer.value.check !== ledgerChecksum(lines.join("\n"))) return { error: "the checksum does not match: the ledger copy is garbled" };
  const calls: LedgerCall[] = [];
  for (const [position, line] of lines.entries()) {
    const call = parseCallLine(line, position);
    if (typeof call === "string") return { error: call };
    calls.push(call);
  }
  return { calls };
}

export function parseRunFile(text: string): RunFile | string {
  const decoded = Either.flatMap(Schema.decodeUnknownEither(RawRunFile)(text), Schema.decodeUnknownEither(RunFileSchema));
  return Either.isLeft(decoded) ? squash(decoded.left.message) : decoded.right;
}

export const emptyRunFile = (slug: string): RunFile => ({ version: RUN_FILE_VERSION, slug, workflows: {} });

export function mergeLedger(file: RunFile, workflow: string, ledger: ReadonlyArray<LedgerCall>): RunFile {
  const before = file.workflows[workflow]?.calls ?? [];
  const calls = ledger.map((entry, n): Call => {
    const old = before[n];
    const kept = old !== undefined && old.label === entry.label;
    return { ...entry, n, tokens: kept ? old.tokens : null, seconds: kept ? old.seconds : null, ran_model: kept ? old.ran_model : null };
  });
  return { ...file, workflows: { ...file.workflows, [workflow]: { calls } } };
}

function verdictFromResult(result: unknown): string {
  const fields = Schema.decodeUnknownOption(Schema.Record({ key: Schema.String, value: Schema.Unknown }))(result);
  if (Option.isNone(fields)) return "";
  if (typeof fields.value.verdict === "string") return fields.value.verdict;
  for (const key of BOOLEAN_VERDICT_KEYS) {
    const flag = fields.value[key];
    if (typeof flag === "boolean") return flag ? VERDICT_PASS : VERDICT_FAIL;
  }
  return "";
}

const JournalLine = Schema.Struct({
  type: Schema.optional(Schema.String),
  key: Schema.optional(Schema.String),
  agentId: Schema.optional(Schema.String),
  label: Schema.optional(Schema.String),
  phase: Schema.optional(Schema.String),
  result: Schema.optional(Schema.Unknown),
});

const MetaFile = Schema.Struct({ agentType: Schema.optional(Schema.String), model: Schema.optional(Schema.String) });

const Count = Schema.optional(Schema.Number);
const TranscriptLine = Schema.Struct({
  timestamp: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
  message: Schema.optional(
    Schema.Struct({
      id: Schema.optional(Schema.String),
      model: Schema.optional(Schema.String),
      usage: Schema.optional(
        Schema.Struct({ input_tokens: Count, output_tokens: Count, cache_creation_input_tokens: Count, cache_read_input_tokens: Count }),
      ),
    }),
  ),
});

interface Started {
  key: string;
  agentId: string;
  label: string;
  phase: string;
  hasResult: boolean;
  verdict: string;
}

function readJournal(text: string): Started[] {
  const started: Started[] = [];
  const results = new Map<string, unknown>();
  for (const line of text.split("\n")) {
    const entry = decodeLoose(JournalLine)(line);
    if (Option.isNone(entry)) continue;
    const { type, label = "", phase = "", result } = entry.value;
    const rawId = entry.value.agentId ?? "";
    const key = entry.value.key ?? rawId;
    if (type === "started") {
      const agentId = AGENT_ID_PATTERN.test(rawId) ? rawId : "";
      started.push({ key, agentId, label, phase, hasResult: false, verdict: "" });
    } else if (type === "result") {
      results.set(key, result);
    }
  }
  return started.map((s) => {
    const result = results.get(s.key);
    const hasResult = result !== null && result !== undefined;
    return { ...s, hasResult, verdict: hasResult ? verdictFromResult(result) : "" };
  });
}

interface Transcript {
  tokens: Tokens | null;
  seconds: number | null;
  ran_model: string | null;
}

const atLeastZero = (value: number | undefined): number => Math.max(0, Math.round(value ?? 0));
const roundToTenth = (value: number): number => Math.round(value * 10) / 10;

function readTranscript(text: string): Transcript {
  const byMessage = new Map<string, { tokens: Tokens; model: string }>();
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  for (const line of text.split("\n")) {
    const entry = decodeLoose(TranscriptLine)(line);
    if (Option.isNone(entry)) continue;
    const time = Date.parse(entry.value.timestamp ?? "");
    if (Number.isFinite(time)) {
      earliest = Math.min(earliest, time);
      latest = Math.max(latest, time);
    }
    const { message } = entry.value;
    if (entry.value.type !== "assistant" || message?.id === undefined || message.usage === undefined) continue;
    const u = message.usage;
    if (Object.values(u).every((v) => v === undefined)) continue;
    const tokens = {
      in: atLeastZero(u.input_tokens),
      out: atLeastZero(u.output_tokens),
      cache_read: atLeastZero(u.cache_read_input_tokens),
      cache_write: atLeastZero(u.cache_creation_input_tokens),
    };
    byMessage.set(message.id, { tokens, model: message.model ?? "" });
  }
  const seconds = Number.isFinite(earliest) ? roundToTenth((latest - earliest) / MS_PER_SECOND) : null;
  if (byMessage.size === 0) return { tokens: null, seconds, ran_model: null };
  const total = { in: 0, out: 0, cache_read: 0, cache_write: 0 };
  const models = new Map<string, number>();
  for (const { tokens, model } of byMessage.values()) {
    total.in += tokens.in;
    total.out += tokens.out;
    total.cache_read += tokens.cache_read;
    total.cache_write += tokens.cache_write;
    if (model !== "") models.set(model, (models.get(model) ?? 0) + 1);
  }
  const ranModel = [...models.entries()].reduce<[string, number] | null>((best, entry) => (best === null || entry[1] > best[1] ? entry : best), null);
  return { tokens: total, seconds, ran_model: ranModel === null ? null : ranModel[0] };
}

export interface Journal {
  dir: string;
  text: string;
}

function callsFromJournals(journals: Journal[], read: (path: string) => string | null): Call[] {
  const calls: Call[] = [];
  for (const { dir, text } of journals) {
    for (const s of readJournal(text)) {
      const metaText = s.agentId === "" ? null : read(join(dir, `${AGENT_FILE_PREFIX}${s.agentId}${META_SUFFIX}`));
      const meta = metaText === null ? Option.none() : decodeLoose(MetaFile)(metaText);
      calls.push({
        n: calls.length,
        label: s.label,
        phase: s.phase,
        agent: Option.isSome(meta) ? (meta.value.agentType ?? "") : "",
        model: Option.isSome(meta) ? (meta.value.model ?? "") : "",
        attempt: FIRST_ATTEMPT,
        outcome: s.hasResult ? OUTCOME_OK : OUTCOME_EMPTY,
        verdict: s.verdict,
        tokens: null,
        seconds: null,
        ran_model: null,
      });
    }
  }
  return calls;
}

export function ingestJournals(
  existing: ReadonlyArray<Call> | null,
  journals: Journal[],
  read: (path: string) => string | null,
): { calls: Call[]; withTokens: number; unmatched: number } {
  const base = existing ?? callsFromJournals(journals, read);
  const claimed = new Set<number>();
  const found = new Map<number, Transcript>();
  let unmatched = 0;
  for (const { dir, text } of journals) {
    for (const s of readJournal(text)) {
      const at = base.findIndex((c, i) => c.label === s.label && c.tokens === null && !claimed.has(i));
      if (at < 0) {
        unmatched++;
        continue;
      }
      claimed.add(at);
      const transcriptText = s.agentId === "" ? null : read(join(dir, `${AGENT_FILE_PREFIX}${s.agentId}${TRANSCRIPT_SUFFIX}`));
      if (transcriptText !== null) found.set(at, readTranscript(transcriptText));
    }
  }
  const calls = base.map((c, i) => ({ ...c, ...found.get(i) }));
  return { calls, withTokens: calls.filter((c) => c.tokens !== null).length, unmatched };
}
