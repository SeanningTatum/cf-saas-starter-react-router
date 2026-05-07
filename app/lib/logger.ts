import { emitLog, type LogLevel } from "./log-format";

interface LogContext {
  [key: string]: unknown;
}

interface Logger {
  trace: (context: LogContext | string, message?: string) => void;
  debug: (context: LogContext | string, message?: string) => void;
  info: (context: LogContext | string, message?: string) => void;
  warn: (context: LogContext | string, message?: string) => void;
  error: (context: LogContext | string, message?: string) => void;
  fatal: (context: LogContext | string, message?: string) => void;
  child: (bindings: LogContext) => Logger;
  bindings: () => LogContext;
}

function createLogger(bindings: LogContext = {}): Logger {
  const log = (
    level: LogLevel,
    context: LogContext | string,
    message?: string
  ) => {
    if (typeof context === "string") {
      emitLog(level, context, bindings);
    } else {
      emitLog(level, message ?? "", { ...bindings, ...context });
    }
  };

  return {
    trace: (context, message) => log("trace", context, message),
    debug: (context, message) => log("debug", context, message),
    info: (context, message) => log("info", context, message),
    warn: (context, message) => log("warn", context, message),
    error: (context, message) => log("error", context, message),
    fatal: (context, message) => log("fatal", context, message),
    child: (childBindings) => createLogger({ ...bindings, ...childBindings }),
    bindings: () => bindings,
  };
}

export const logger = createLogger();

export type LogLayer =
  | "client"
  | "server"
  | "loader"
  | "action"
  | "trpc"
  | "repository"
  | "auth"
  | "middleware"
  | "workflow";

export function createLayerLogger(layer: LogLayer) {
  return logger.child({ layer });
}

export function createRequestLogger(
  layer: LogLayer,
  context?: {
    traceId?: string;
    path?: string;
    userId?: string;
    [key: string]: unknown;
  }
) {
  const traceId = context?.traceId ?? generateTraceId();
  return logger.child({
    layer,
    traceId,
    ...context,
  });
}

export function generateTraceId(): string {
  return Math.random().toString(16).slice(2, 10);
}

export const loggers = {
  client: createLayerLogger("client"),
  server: createLayerLogger("server"),
  loader: createLayerLogger("loader"),
  action: createLayerLogger("action"),
  trpc: createLayerLogger("trpc"),
  repository: createLayerLogger("repository"),
  auth: createLayerLogger("auth"),
  middleware: createLayerLogger("middleware"),
  workflow: createLayerLogger("workflow"),
} as const;
