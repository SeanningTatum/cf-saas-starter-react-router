import {
  Context,
  FiberRef,
  FiberRefs,
  HashMap,
  Logger,
  LogLevel,
  Option,
  Tracer,
} from "effect";
import { emitLog, isDev, type LogLevel as AppLogLevel } from "@/lib/log-format";
import {
  CurrentRequest,
  keepsLogs,
  requestLogFields,
} from "@/lib/request-context";

export const toAppLevel = (level: LogLevel.LogLevel): AppLogLevel => {
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

export const stringify = (message: unknown): string => {
  if (Array.isArray(message)) {
    return message
      .map((m) => (typeof m === "string" ? m : JSON.stringify(m)))
      .join(" ");
  }
  return typeof message === "string" ? message : JSON.stringify(message);
};

/**
 * Reads the active tracer span (set by `Effect.withSpan`) out of the log
 * event's fiber context, so every log emitted inside a span automatically
 * carries `traceId`/`spanId` — the correlation key between logs and traces.
 */
export const currentSpanAnnotations = (
  context: FiberRefs.FiberRefs
): Record<string, string> => {
  const fiberContext = FiberRefs.getOrDefault(context, FiberRef.currentContext);
  const span = Context.getOption(fiberContext, Tracer.ParentSpan);
  if (Option.isNone(span)) return {};
  return { traceId: span.value.traceId, spanId: span.value.spanId };
};

/**
 * Reads the request (`CurrentRequest`, provided by the per-request runtime)
 * out of the log event's fiber context, so every Effect log carries the
 * request id, and the user id once the session has resolved. Read from the
 * fiber, not from the async-local store: Effect's scheduler is shared across
 * requests, so a fiber can resume inside another request's async context.
 */
export const currentRequestAnnotations = (
  context: FiberRefs.FiberRefs
): { requestId?: string; userId?: string } => {
  const fiberContext = FiberRefs.getOrDefault(context, FiberRef.currentContext);
  const request = Context.getOption(fiberContext, CurrentRequest);
  return requestLogFields(Option.getOrUndefined(request));
};

export const currentRequestLogSampled = (
  context: FiberRefs.FiberRefs
): boolean | undefined => {
  const fiberContext = FiberRefs.getOrDefault(context, FiberRef.currentContext);
  const request = Context.getOption(fiberContext, CurrentRequest);
  return Option.isSome(request) ? keepsLogs(request.value) : undefined;
};

const customLogger = Logger.make(({ logLevel, message, annotations, context }) => {
  const ann: Record<string, unknown> = {
    ...currentSpanAnnotations(context),
    ...currentRequestAnnotations(context),
  };
  HashMap.forEach(annotations, (value, key) => {
    ann[key] = value;
  });
  emitLog(
    toAppLevel(logLevel),
    stringify(message),
    ann,
    currentRequestLogSampled(context)
  );
});

export const LoggerLive = Logger.replace(Logger.defaultLogger, customLogger);

export const MinLogLevelLive = Logger.minimumLogLevel(
  isDev ? LogLevel.Trace : LogLevel.Info
);
