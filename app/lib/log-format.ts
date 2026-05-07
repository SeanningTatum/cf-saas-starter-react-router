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
const minLevel = isDev ? LEVEL_VALUE.trace : LEVEL_VALUE.info;

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
  LEVEL_VALUE[level] >= minLevel;

export function emitLog(
  level: LogLevel,
  message: string,
  annotations: Record<string, unknown> = {}
): void {
  if (!shouldLog(level)) return;

  const time = new Date().toISOString();
  const data: Record<string, unknown> = {
    ...annotations,
    level,
    time,
    msg: message,
  };

  if (isDev) {
    const { layer, traceId, ...rest } = data;
    const prefix = [
      layer ? `[${layer}]` : "",
      traceId ? `(${traceId})` : "",
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
