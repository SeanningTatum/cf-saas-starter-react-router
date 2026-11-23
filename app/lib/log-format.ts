import { Effect } from "effect";
import { ALWAYS_KEPT_ANNOTATION, UNWRITABLE_LOG_LINE } from "./constants/redaction";
import {
  ANSI_RESET,
  LOG_LEVEL_COLORS,
  LOG_LEVEL_VALUE,
  SHORT_REQUEST_ID_LENGTH,
} from "./constants/logging";
import { redactFields } from "./redact";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export const isDev = import.meta.env.DEV;

export const isLevelEnabled = (level: LogLevel, min: LogLevel): boolean =>
  LOG_LEVEL_VALUE[level] >= LOG_LEVEL_VALUE[min];

export const shouldLog = (level: LogLevel) => isLevelEnabled(level, isDev ? "trace" : "info");

type LogContextProvider = () => Record<string, unknown>;

let logContext: LogContextProvider = () => ({});

export const setLogContext = (provider: LogContextProvider): void => {
  logContext = provider;
};

type LogSampler = () => boolean;

let logSampler: LogSampler = () => true;

export const setLogSampler = (sampler: LogSampler): void => {
  logSampler = sampler;
};

const isKeptWhenUnsampled = (level: LogLevel, annotations: Record<string, unknown>): boolean =>
  isLevelEnabled(level, "warn") || annotations[ALWAYS_KEPT_ANNOTATION] === true;

const redactedLine = (
  fields: () => Record<string, unknown>,
  level: LogLevel,
  time: string,
): Record<string, unknown> =>
  Effect.runSync(
    Effect.try(() => redactFields(fields())).pipe(
      Effect.orElseSucceed(() => ({ level, time, msg: UNWRITABLE_LOG_LINE })),
    ),
  );

export function emitLog(
  level: LogLevel,
  message: string,
  annotations: Record<string, unknown> = {},
  sampled: boolean = logSampler(),
): void {
  if (!shouldLog(level)) return;
  if (!sampled && !isKeptWhenUnsampled(level, annotations)) return;

  const time = new Date().toISOString();
  const data = redactedLine(
    () => {
      const required = { level, time, msg: message };
      return Object.assign({ ...required }, logContext(), annotations, required);
    },
    level,
    time,
  );

  if (isDev) {
    const { layer, requestId, traceId, ...others } = data;
    const shortRequestId =
      typeof requestId === "string" && requestId.length > 0
        ? requestId.slice(0, SHORT_REQUEST_ID_LENGTH)
        : undefined;
    const id = shortRequestId ?? traceId;
    const rest = shortRequestId && traceId !== undefined ? { ...others, traceId } : others;
    const prefix = [layer ? `[${layer}]` : "", id ? `(${id})` : ""].filter(Boolean).join(" ");
    const ctx = Object.keys(rest).length > 3 ? ` ${JSON.stringify(rest)}` : "";
    const fn = level === "fatal" ? "error" : level === "trace" ? "debug" : level;
    // biome-ignore lint/suspicious/noConsole: this function is the one log sink
    console[fn](
      `${LOG_LEVEL_COLORS[level]}${level.toUpperCase().padEnd(5)}${ANSI_RESET} ${prefix} ${data.msg}${ctx}`,
    );
  } else {
    // biome-ignore lint/suspicious/noConsole: this function is the one log sink
    console.log(JSON.stringify(data));
  }
}
