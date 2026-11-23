import { Clock, Context, Effect, Layer } from "effect";
import {
  DEVELOPMENT_ENVIRONMENT,
  MAX_REPORTS_PER_REQUEST,
  PRODUCTION_ENVIRONMENT,
  REMOTE_REPORT_WINDOW_LIMIT,
  REMOTE_REPORT_WINDOW_MS,
  REPORT_ID_BYTES,
  UNKNOWN_RELEASE,
} from "@/lib/constants/error-reporting";
import type { ErrorReporterAdapter } from "@/lib/error-reporting/adapter";
import { consoleAdapter } from "@/lib/error-reporting/adapters/console";
import { noopAdapter } from "@/lib/error-reporting/adapters/noop";
import { parseSentryDsn, sentryAdapter } from "@/lib/error-reporting/adapters/sentry";
import { buildReport, type ErrorCapture } from "@/lib/error-reporting/report";
import { makeReportBudget, type ReportBudget } from "@/lib/error-reporting/report-budget";
import { isObject } from "@/lib/error-reporting/text";
import { isDev } from "@/lib/log-format";
import { loggers } from "@/lib/logger";
import { randomHex, type RequestContext } from "@/lib/request-context";

export interface ErrorReporterShape {
  readonly capture: (capture: ErrorCapture) => Effect.Effect<void>;
}

export class ErrorReporter extends Context.Tag("app/ErrorReporter")<
  ErrorReporter,
  ErrorReporterShape
>() {}

const remoteBudget = makeReportBudget({
  limit: REMOTE_REPORT_WINDOW_LIMIT,
  windowMs: REMOTE_REPORT_WINDOW_MS,
});

const loggedThenSentIfError = (
  remote: ErrorReporterAdapter,
  budget: ReportBudget,
): ErrorReporterAdapter => ({
  name: remote.name,
  send: (batch) => {
    const errors = batch.filter((report) => report.level === "error");
    return consoleAdapter.send(batch).pipe(
      Effect.zipRight(Clock.currentTimeMillis),
      Effect.flatMap((ms) =>
        errors.length > 0 && budget.take(ms) ? remote.send(errors) : Effect.void,
      ),
    );
  },
});

export const selectErrorAdapter = (
  env: Partial<Env>,
  budget: ReportBudget = remoteBudget,
): ErrorReporterAdapter => {
  const dsn = parseSentryDsn(env.SENTRY_DSN);
  switch (env.ERROR_REPORTER) {
    case "none":
      return noopAdapter;
    case "sentry":
      return dsn ? loggedThenSentIfError(sentryAdapter({ dsn }), budget) : consoleAdapter;
    default:
      return consoleAdapter;
  }
};

export const readRelease = (env: Partial<Env>): string => env.RELEASE_VERSION || UNKNOWN_RELEASE;

export const readEnvironment = (env: Partial<Env>, dev: boolean = isDev): string =>
  env.ENVIRONMENT || (dev ? DEVELOPMENT_ENVIRONMENT : PRODUCTION_ENVIRONMENT);

export interface ErrorReporterOptions {
  readonly adapter: ErrorReporterAdapter;
  readonly release: string;
  readonly environment: string;
  readonly request?: RequestContext;
  readonly waitUntil: (delivery: Promise<void>) => void;
}

export const makeErrorReporter = (options: ErrorReporterOptions): ErrorReporterShape => {
  const { adapter, request } = options;
  const counts = { captured: 0 };
  const seen = new WeakSet<object>();
  const alreadyCaptured = (error: unknown): boolean => {
    if (!isObject(error)) return false;
    if (seen.has(error)) return true;
    seen.add(error);
    return false;
  };

  const deliver = (capture: ErrorCapture, ms: number): Effect.Effect<void> =>
    Effect.suspend(() =>
      adapter.send([
        buildReport(capture, {
          id: randomHex(REPORT_ID_BYTES),
          timestamp: new Date(ms).toISOString(),
          release: options.release,
          environment: options.environment,
          requestId: request?.requestId,
          userId: request?.userId,
          method: request?.method,
          path: request?.path,
        }),
      ]),
    ).pipe(
      Effect.catchAllCause((cause) =>
        Effect.sync(() =>
          loggers.server.warn(
            { provider: adapter.name, cause: String(cause) },
            "error report delivery failed; report dropped",
          ),
        ),
      ),
    );

  return {
    capture: (capture) =>
      Effect.map(Clock.currentTimeMillis, (ms) => {
        if (alreadyCaptured(capture.error)) return;
        counts.captured += 1;
        if (counts.captured > MAX_REPORTS_PER_REQUEST) {
          if (counts.captured === MAX_REPORTS_PER_REQUEST + 1) {
            loggers.server.warn(
              { limit: MAX_REPORTS_PER_REQUEST },
              "error report limit reached for this request; later reports dropped",
            );
          }
          return;
        }
        options.waitUntil(Effect.runPromise(deliver(capture, ms)));
      }),
  };
};

export const requestErrorReporter = (
  env: Partial<Env>,
  request?: RequestContext,
  waitUntil: (delivery: Promise<void>) => void = () => undefined,
): ErrorReporterShape =>
  makeErrorReporter({
    adapter: selectErrorAdapter(env),
    release: readRelease(env),
    environment: readEnvironment(env),
    request,
    waitUntil,
  });

export const ErrorReporterFrom = (reporter: ErrorReporterShape) =>
  Layer.succeed(ErrorReporter, reporter);

export const reportError = (reporter: ErrorReporterShape, capture: ErrorCapture): void =>
  Effect.runSync(reporter.capture(capture));
