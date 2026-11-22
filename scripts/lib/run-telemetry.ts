import { Either, Option, Schema } from "effect";
import {
  CALL_FIELD_COUNT,
  CHECKSUM_DIGITS,
  FIELD_MAX_LENGTH,
  FIRST_ATTEMPT,
  FNV_OFFSET_BASIS,
  FNV_PRIME,
  HEX_RADIX,
  LEDGER_COMPARE_FIELDS,
  LEDGER_TEXT_FIELDS,
  OUTCOMES,
  RUN_FILE_VERSION,
  SLUG_PATTERN,
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
    agent_id: Schema.optionalWith(Schema.NullOr(Text), { default: () => null }),
    from_journal: Schema.optionalWith(Schema.Boolean, { default: () => false }),
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
export type Tokens = typeof TokensSchema.Type;

const squash = (text: string) => text.replace(/\s+/g, " ").trim();
export const decodeLoose = <A, I>(schema: Schema.Schema<A, I>) => Schema.decodeUnknownOption(Schema.parseJson(schema));

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

const sameCall = (stored: Call, entry: LedgerCall | undefined): boolean =>
  entry !== undefined && LEDGER_COMPARE_FIELDS.every((field) => stored[field] === entry[field]);

export function mergeLedger(file: RunFile, workflow: string, ledger: ReadonlyArray<LedgerCall>): RunFile {
  const stored = file.workflows[workflow]?.calls ?? [];
  const fromLedger = stored.filter((c) => !c.from_journal);
  const extendsStored = ledger.length > fromLedger.length && fromLedger.every((c, i) => sameCall(c, ledger[i]));
  const appended = stored.filter((c) => c.from_journal);
  const keptFor = (entry: LedgerCall, n: number): Call | undefined => {
    if (!extendsStored) return undefined;
    if (n < fromLedger.length) return fromLedger[n];
    const at = appended.findIndex((c) => c.label === entry.label);
    return at < 0 ? undefined : appended.splice(at, 1)[0];
  };
  const calls = ledger.map((entry, n): Call => {
    const kept = keptFor(entry, n);
    return {
      ...entry,
      n,
      agent_id: kept?.agent_id ?? null,
      from_journal: false,
      tokens: kept?.tokens ?? null,
      seconds: kept?.seconds ?? null,
      ran_model: kept?.ran_model ?? null,
    };
  });
  return { ...file, workflows: { ...file.workflows, [workflow]: { calls } } };
}
