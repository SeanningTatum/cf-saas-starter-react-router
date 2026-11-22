export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const LEVEL_VALUE: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export const isDev = import.meta.env.DEV;

/**
 * Pure, parameterized level comparison — `shouldLog` below always compares
 * against the module's fixed `minLevel` (derived from `isDev` at import
 * time), which makes the "filtered out" branch untestable in an environment
 * where `isDev` is always true. This function takes `minLevel` as an
 * argument so both the pass and filtered cases can be exercised directly.
 */
export const isLevelEnabled = (level: LogLevel, min: LogLevel): boolean =>
  LEVEL_VALUE[level] >= LEVEL_VALUE[min];

const COLORS: Record<LogLevel, string> = {
  trace: "\x1b[90m",
  debug: "\x1b[36m",
  info: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
  fatal: "\x1b[35m",
};
const RESET = "\x1b[0m";

export const shouldLog = (level: LogLevel) =>
  isLevelEnabled(level, isDev ? "trace" : "info");

type LogContextProvider = () => Record<string, unknown>;

let logContext: LogContextProvider = () => ({});

/**
 * Sets the fields every log line starts from. `app/lib/request-context.ts`
 * registers its async-local store here (`requestId`, `userId`) when it loads;
 * this module stays free of Node imports because a client bundle may load it.
 * Explicit annotations passed to `emitLog` win over these fields.
 */
export const setLogContext = (provider: LogContextProvider): void => {
  logContext = provider;
};

export function emitLog(
  level: LogLevel,
  message: string,
  annotations: Record<string, unknown> = {}
): void {
  if (!shouldLog(level)) return;

  const time = new Date().toISOString();
  const data: Record<string, unknown> = {
    ...logContext(),
    ...annotations,
    level,
    time,
    msg: message,
  };

  if (isDev) {
    // The request id leads the line, shortened; with no request, the trace
    // id leads as before. Whichever id leads stays out of the trailing JSON.
    const { layer, requestId, traceId, ...others } = data;
    const shortRequestId =
      typeof requestId === "string" && requestId.length > 0
        ? requestId.slice(0, 8)
        : undefined;
    const id = shortRequestId ?? traceId;
    const rest =
      shortRequestId && traceId !== undefined ? { ...others, traceId } : others;
    const prefix = [
      layer ? `[${layer}]` : "",
      id ? `(${id})` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const ctx =
      Object.keys(rest).length > 3 ? ` ${JSON.stringify(rest)}` : "";
    const fn =
      level === "fatal" ? "error" : level === "trace" ? "debug" : level;
    console[fn](
      `${COLORS[level]}${level.toUpperCase().padEnd(5)}${RESET} ${prefix} ${message}${ctx}`
    );
  } else {
    console.log(JSON.stringify(data));
  }
}
