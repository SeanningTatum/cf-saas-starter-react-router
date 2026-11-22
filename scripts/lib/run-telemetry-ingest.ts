import { join } from "node:path";
import { Option, Schema } from "effect";
import {
  AGENT_FILE_PREFIX,
  AGENT_ID_PATTERN,
  BOOLEAN_VERDICT_KEYS,
  FIRST_ATTEMPT,
  META_SUFFIX,
  MS_PER_SECOND,
  OUTCOME_EMPTY,
  OUTCOME_OK,
  TRANSCRIPT_SUFFIX,
  VERDICT_FAIL,
  VERDICT_PASS,
} from "./run-telemetry-constants";
import { decodeLoose, type Call, type Tokens } from "./run-telemetry";

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

export function readJournal(text: string): Started[] {
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

export function readTranscript(text: string): Transcript {
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

type Reader = (path: string) => string | null;

function callFromEntry(entry: ReturnType<typeof readJournal>[number], n: number, dir: string, read: Reader, found: Transcript | null): Call {
  const metaText = read(join(dir, `${AGENT_FILE_PREFIX}${entry.agentId}${META_SUFFIX}`));
  const meta = metaText === null ? Option.none() : decodeLoose(MetaFile)(metaText);
  return {
    n,
    label: entry.label,
    phase: entry.phase,
    agent: Option.isSome(meta) ? (meta.value.agentType ?? "") : "",
    model: Option.isSome(meta) ? (meta.value.model ?? "") : "",
    attempt: FIRST_ATTEMPT,
    outcome: entry.hasResult ? OUTCOME_OK : OUTCOME_EMPTY,
    verdict: entry.verdict,
    agent_id: entry.agentId,
    from_journal: true,
    tokens: found?.tokens ?? null,
    seconds: found?.seconds ?? null,
    ran_model: found?.ran_model ?? null,
  };
}

export function ingestJournals(
  existing: ReadonlyArray<Call> | null,
  journals: Journal[],
  read: Reader,
): { calls: Call[]; withTokens: number; added: number } {
  const calls: Call[] = [...(existing ?? [])];
  const claimed = new Set<number>();
  let added = 0;
  for (const { dir, text } of journals) {
    for (const entry of readJournal(text)) {
      const id = entry.agentId;
      const transcriptText = id === "" ? null : read(join(dir, `${AGENT_FILE_PREFIX}${id}${TRANSCRIPT_SUFFIX}`));
      const found = transcriptText === null ? null : readTranscript(transcriptText);
      const owner = id === "" ? -1 : calls.findIndex((c) => c.agent_id === id);
      const free = calls.findIndex((c, i) => c.label === entry.label && c.agent_id === null && !claimed.has(i));
      const newer = calls.findIndex((c, i) => c.label === entry.label && !claimed.has(i));
      const current = calls[owner >= 0 ? owner : free >= 0 ? free : newer];
      if (id === "") {
        if (free >= 0) claimed.add(free);
        continue;
      }
      if (owner >= 0 && current !== undefined) {
        claimed.add(owner);
        if (current.tokens === null && found !== null) calls[owner] = { ...current, ...found };
      } else if (free >= 0 && current !== undefined) {
        claimed.add(free);
        calls[free] = { ...current, agent_id: id, ...found };
      } else if (newer >= 0 && current !== undefined) {
        claimed.add(newer);
        calls[newer] = { ...current, agent_id: id, tokens: found?.tokens ?? null, seconds: found?.seconds ?? null, ran_model: found?.ran_model ?? null };
      } else {
        calls.push(callFromEntry(entry, calls.length, dir, read, found));
        claimed.add(calls.length - 1);
        if (existing !== null) added++;
      }
    }
  }
  return { calls, withTokens: calls.filter((c) => c.tokens !== null).length, added };
}
