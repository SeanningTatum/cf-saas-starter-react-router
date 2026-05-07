import { HashMap, Logger, LogLevel } from "effect";
import { emitLog, isDev, type LogLevel as AppLogLevel } from "@/lib/log-format";

const toAppLevel = (level: LogLevel.LogLevel): AppLogLevel => {
  switch (level._tag) {
    case "Trace":
      return "trace";
    case "Debug":
      return "debug";
    case "Info":
      return "info";
    case "Warning":
      return "warn";
    case "Error":
      return "error";
    case "Fatal":
      return "fatal";
    default:
      return "info";
  }
};

const stringify = (message: unknown): string => {
  if (Array.isArray(message)) {
    return message
      .map((m) => (typeof m === "string" ? m : JSON.stringify(m)))
      .join(" ");
  }
  return typeof message === "string" ? message : JSON.stringify(message);
};

const customLogger = Logger.make(({ logLevel, message, annotations }) => {
  const ann: Record<string, unknown> = {};
  HashMap.forEach(annotations, (value, key) => {
    ann[key] = value;
  });
  emitLog(toAppLevel(logLevel), stringify(message), ann);
});

export const LoggerLive = Logger.replace(Logger.defaultLogger, customLogger);

export const MinLogLevelLive = Logger.minimumLogLevel(
  isDev ? LogLevel.Trace : LogLevel.Info
);
