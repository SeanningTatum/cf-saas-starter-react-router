import { Clock, Effect, Exit, type ManagedRuntime } from "effect";
import {
  HEALTHZ_ALLOWED_METHODS,
  HEALTHZ_CACHED_ATTRIBUTE,
  HEALTHZ_CHECK_TTL_MS,
  HEALTHZ_DOWN_STATUS,
  HEALTHZ_HEADERS,
  HEALTHZ_UP_ATTRIBUTE,
  HEALTHZ_UP_STATUS,
  HEALTHZ_WRONG_METHOD_STATUS,
  HEALTH_UP,
} from "@/lib/constants/health";
import { HEALTHZ_CHECK_SPAN } from "@/lib/constants/spans";
import { healthReport, makeHealthMemo, type HealthReport } from "@/lib/health-check";
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

const databaseMemo = makeHealthMemo(HEALTHZ_CHECK_TTL_MS);

const databaseUp = Effect.gen(function* () {
  const now = yield* Clock.currentTimeMillis;
  const cached = databaseMemo.read(now);
  yield* Effect.annotateCurrentSpan(HEALTHZ_CACHED_ATTRIBUTE, cached !== undefined);
  if (cached !== undefined) return cached;
  const repo = yield* HealthRepository;
  const ping = yield* repo.pingDatabase();
  databaseMemo.write(now, ping.ok);
  return ping.ok;
}).pipe(
  Effect.tap((up) => Effect.annotateCurrentSpan(HEALTHZ_UP_ATTRIBUTE, up)),
  Effect.withSpan(HEALTHZ_CHECK_SPAN),
);

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
  const exit = await context.runtime.runPromiseExit(databaseUp);
  if (Exit.isFailure(exit)) context.reportError({ error: exit.cause, source: "loader" });
  const up = Exit.isSuccess(exit) && exit.value;
  return respond(healthReport(up, readRelease(context.cloudflare.env)));
}
