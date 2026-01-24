/**
 * Logger configuration for Cloudflare Workers environment.
 *
 * This is a simple console-based logger that's compatible with Cloudflare Workers
 * (which don't support Node.js APIs like WeakRef used by pino).
 *
 * Development: Verbose logging with all levels (trace, debug, info, warn, error)
 * Production: Only info level and above (no debug/trace)
 */

const isDev = import.meta.env.DEV;

type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const currentLevel = isDev ? LOG_LEVELS.trace : LOG_LEVELS.info;

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
  const log = (level: LogLevel, context: LogContext | string, message?: string) => {
    if (LOG_LEVELS[level] < currentLevel) return;

    const timestamp = new Date().toISOString();
    let logData: LogContext;
    let msg: string;

    if (typeof context === "string") {
      msg = context;
      logData = { ...bindings, level, time: timestamp, msg };
    } else {
      msg = message || "";
      logData = { ...bindings, ...context, level, time: timestamp, msg };
    }

    // In production, output JSON for structured logging
    // In development, output readable format
    if (isDev) {
      const { layer, traceId, ...rest } = logData;
      const prefix = [
        layer ? `[${layer}]` : "",
        traceId ? `(${traceId})` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const contextStr = Object.keys(rest).length > 3
        ? ` ${JSON.stringify(rest)}`
        : "";
      
      const levelColors: Record<LogLevel, string> = {
        trace: "\x1b[90m", // gray
        debug: "\x1b[36m", // cyan
        info: "\x1b[32m",  // green
        warn: "\x1b[33m",  // yellow
        error: "\x1b[31m", // red
        fatal: "\x1b[35m", // magenta
      };
      const reset = "\x1b[0m";
      const color = levelColors[level];
      
      console[level === "fatal" ? "error" : level === "trace" ? "debug" : level](
        `${color}${level.toUpperCase().padEnd(5)}${reset} ${prefix} ${msg}${contextStr}`
      );
    } else {
      console.log(JSON.stringify(logData));
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

/**
 * Layer identifiers for grouping logs
 */
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

/**
 * Create a child logger with layer context for grouping
 *
 * @example
 * const log = createLayerLogger("repository");
 * log.info({ userId: "123" }, "Fetching user");
 */
export function createLayerLogger(layer: LogLayer) {
  return logger.child({ layer });
}

/**
 * Create a request-scoped logger with trace ID for distributed tracing.
 * Use this to correlate logs across client -> server -> tRPC -> repository.
 *
 * @example
 * // In a loader or tRPC route
 * const log = createRequestLogger("trpc", { path: "user.getById" });
 * log.info({ userId }, "Fetching user");
 *
 * // Later in repository
 * const repoLog = createRequestLogger("repository", { traceId: log.bindings().traceId });
 * repoLog.debug({ query: "SELECT * FROM users" }, "Executing query");
 */
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

/**
 * Generate a short trace ID for request correlation.
 * Format: 8 character hex string (e.g., "a1b2c3d4")
 */
export function generateTraceId(): string {
  return Math.random().toString(16).slice(2, 10);
}

// Pre-configured layer loggers for convenience
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

/**
 * Logging patterns for common scenarios:
 *
 * 1. LOADER/ACTION ENTRY:
 *    loggers.loader.info({ route: "/admin/users" }, "Loader started");
 *
 * 2. TRPC PROCEDURE:
 *    loggers.trpc.debug({ input, path: "user.getById" }, "Procedure called");
 *
 * 3. REPOSITORY OPERATION:
 *    loggers.repository.debug({ table: "users", operation: "select" }, "Query executing");
 *
 * 4. ERROR HANDLING:
 *    loggers.repository.error({ err, userId }, "Failed to fetch user");
 *
 * 5. REQUEST TRACING (correlate logs across layers):
 *    const traceId = generateTraceId();
 *    const log = createRequestLogger("loader", { traceId, route: "/admin" });
 *    // Pass traceId to tRPC context, then to repository
 *
 * 6. PERFORMANCE MEASUREMENT:
 *    const start = Date.now();
 *    // ... operation
 *    loggers.trpc.info({ durationMs: Date.now() - start }, "Operation complete");
 */
