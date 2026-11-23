import { Clock, Effect, Exit, type ManagedRuntime } from "effect";
import {
  BROWSER_REPORT_BUDGET_SPENT_STATUS,
  BROWSER_REPORT_FAILED_STATUS,
  BROWSER_REPORT_METHOD,
  BROWSER_REPORT_RETRY_AFTER_SECONDS,
  BROWSER_REPORT_WINDOW_LIMIT,
  BROWSER_REPORT_WINDOW_MS,
  BROWSER_REPORT_WRONG_METHOD_STATUS,
} from "@/lib/constants/error-reporting";
import { readBrowserReports, type ReportIntake } from "@/lib/error-reporting/browser-report";
import { makeReportBudget } from "@/lib/error-reporting/report-budget";
import type { ErrorCapture } from "@/lib/error-reporting/report";
import { loggers } from "@/lib/logger";
import { ErrorReporter } from "@/services/error-reporter";

export interface BrowserReportContext {
  readonly runtime: Pick<ManagedRuntime.ManagedRuntime<ErrorReporter, unknown>, "runPromiseExit">;
  readonly reportError: (capture: ErrorCapture) => void;
}

export interface BrowserReportArgs {
  readonly request: Request;
  readonly context: BrowserReportContext;
}

type Outcome =
  | ReportIntake
  | {
      readonly status:
        | typeof BROWSER_REPORT_WRONG_METHOD_STATUS
        | typeof BROWSER_REPORT_BUDGET_SPENT_STATUS;
      readonly reason: string;
    };

const browserReportBudget = makeReportBudget({
  limit: BROWSER_REPORT_WINDOW_LIMIT,
  windowMs: BROWSER_REPORT_WINDOW_MS,
});

const wrongMethod = (): Outcome => ({
  status: BROWSER_REPORT_WRONG_METHOD_STATUS,
  reason: "method not allowed",
});

const budgetSpent = (): Outcome => ({
  status: BROWSER_REPORT_BUDGET_SPENT_STATUS,
  reason: "report budget spent",
});

const headersFor = (status: number): HeadersInit => {
  if (status === BROWSER_REPORT_WRONG_METHOD_STATUS) return { allow: BROWSER_REPORT_METHOD };
  if (status === BROWSER_REPORT_BUDGET_SPENT_STATUS) {
    return { "retry-after": String(BROWSER_REPORT_RETRY_AFTER_SECONDS) };
  }
  return {};
};

const respond = (outcome: Outcome): Response => {
  if ("reason" in outcome) {
    loggers.server.debug(
      { status: outcome.status, reason: outcome.reason },
      "browser report rejected",
    );
  }
  return new Response(null, { status: outcome.status, headers: headersFor(outcome.status) });
};

export async function loader(): Promise<Response> {
  return respond(wrongMethod());
}

export async function action({ request, context }: BrowserReportArgs): Promise<Response> {
  if (request.method !== BROWSER_REPORT_METHOD) return respond(wrongMethod());

  const program = Effect.gen(function* () {
    const intake = yield* readBrowserReports(request);
    if (!("captures" in intake)) return intake;
    const now = yield* Clock.currentTimeMillis;
    if (!browserReportBudget.take(now)) return budgetSpent();
    const reporter = yield* ErrorReporter;
    yield* Effect.forEach(intake.captures, reporter.capture, { discard: true });
    return intake;
  });

  const exit = await context.runtime.runPromiseExit(program);
  return Exit.match(exit, {
    onSuccess: respond,
    onFailure: (cause) => {
      context.reportError({ error: cause, source: "action" });
      return new Response(null, { status: BROWSER_REPORT_FAILED_STATUS });
    },
  });
}
