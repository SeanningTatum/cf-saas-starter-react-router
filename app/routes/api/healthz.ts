import { Duration, Effect, Exit, type ManagedRuntime } from "effect";
import {
  HEALTHZ_ALLOWED_METHODS,
  HEALTHZ_CHECK_TTL_MS,
  HEALTHZ_DOWN_LOG,
  HEALTHZ_QUERY_TIMEOUT_MS,
  HEALTHZ_DOWN_STATUS,
  HEALTHZ_HEADERS,
  HEALTHZ_UP_ATTRIBUTE,
  HEALTHZ_UP_STATUS,
  HEALTHZ_WRONG_METHOD_STATUS,
  HEALTH_UP,
} from "@/lib/constants/health";
import { HEALTHZ_CHECK_SPAN } from "@/lib/constants/spans";
import { healthReport, makeSharedCheck, type HealthReport } from "@/lib/health-check";
import type { ErrorCapture } from "@/lib/error-reporting/report";
import { HealthRepository } from "@/repositories/health";
import { readRelease } from "@/services/error-reporter";

export interface HealthzContext {
  readonly runtime: Pick<
    ManagedRuntime.ManagedRuntime<HealthRepository, unknown>,
    "runPromiseExit"
  >;
  readonly cloudflare: { readonly env: Partial<Env> };
  readonly reportError: (capture: ErrorCapture) => void;
}

export interface HealthzArgs {
  readonly context: HealthzContext;
}

const databaseCheck = makeSharedCheck(HEALTHZ_CHECK_TTL_MS);

const databaseUp = Effect.gen(function* () {
  const repo = yield* HealthRepository;
  const ping = yield* repo.pingDatabase();
  if (!ping.ok)
    yield* Effect.logWarning(HEALTHZ_DOWN_LOG).pipe(Effect.annotateLogs({ error: ping.error }));
  return ping.ok;
}).pipe(
  Effect.timeoutTo({
    duration: Duration.millis(HEALTHZ_QUERY_TIMEOUT_MS),
    onSuccess: (up) => up,
    onTimeout: () => false,
  }),
  Effect.tap((up) => Effect.annotateCurrentSpan(HEALTHZ_UP_ATTRIBUTE, up)),
  Effect.withSpan(HEALTHZ_CHECK_SPAN),
);

const checkOnce = async (context: HealthzContext): Promise<boolean> => {
  const exit = await context.runtime.runPromiseExit(databaseUp);
  if (Exit.isFailure(exit)) context.reportError({ error: exit.cause, source: "loader" });
  return Exit.isSuccess(exit) && exit.value;
};

const respond = (report: HealthReport): Response =>
  new Response(JSON.stringify(report), {
    status: report.status === HEALTH_UP ? HEALTHZ_UP_STATUS : HEALTHZ_DOWN_STATUS,
    headers: HEALTHZ_HEADERS,
  });

export async function action(): Promise<Response> {
  return new Response(null, {
    status: HEALTHZ_WRONG_METHOD_STATUS,
    headers: { allow: HEALTHZ_ALLOWED_METHODS },
  });
}

export async function loader({ context }: HealthzArgs): Promise<Response> {
  const up = await databaseCheck.get(Date.now(), () => checkOnce(context));
  return respond(healthReport(up, readRelease(context.cloudflare.env)));
}
