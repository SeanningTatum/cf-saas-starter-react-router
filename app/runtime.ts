import { Layer, ManagedRuntime, Tracer } from "effect";
import { CloudflareEnvLive } from "@/services/cloudflare";
import { DatabaseLive, type Database } from "@/services/database";
import { BucketLive, type Bucket } from "@/services/bucket";
import { AuthApiLive, type AuthApi as AuthApiTag } from "@/services/auth";
import type { AuthRuntimeOptions } from "@/auth/config";
import { LoggerLive, MinLogLevelLive } from "@/services/logger";
import { AnalyticsLive, type Analytics } from "@/services/analytics";
import { RateLimiterLive, type RateLimiter } from "@/services/rate-limit";
import {
  ErrorReporterFrom,
  requestErrorReporter,
  type ErrorReporter,
  type ErrorReporterShape,
} from "@/services/error-reporter";
import { TracingLayer, type FetchLike } from "@/services/tracing";
import { redactPath } from "@/lib/redact";
import { CurrentRequest, type RequestContext } from "@/lib/request-context";
import { UserRepository } from "@/repositories/user";
import { AnalyticsRepository } from "@/repositories/analytics";
import { BucketRepository } from "@/repositories/bucket";
import { HealthRepository } from "@/repositories/health";

export type AppServices =
  | Database
  | Bucket
  | AuthApiTag
  | Analytics
  | RateLimiter
  | ErrorReporter
  | UserRepository
  | AnalyticsRepository
  | BucketRepository
  | HealthRepository;

const requestLayer = (
  request: RequestContext
): Layer.Layer<CurrentRequest | Tracer.ParentSpan> =>
  Layer.merge(
    Layer.succeed(CurrentRequest, request),
    Layer.span("http.request", {
      kind: "server",
      parent: request.parent
        ? Tracer.externalSpan({
            traceId: request.parent.traceId,
            spanId: request.parent.spanId,
            sampled: request.parent.sampled,
          })
        : undefined,
      attributes: {
        "http.request.method": request.method,
        "url.path": redactPath(request.path),
      },
    })
  );

export const observabilityLayer = (
  env: object,
  request?: RequestContext,
  fetchFn?: FetchLike
): Layer.Layer<never> => {
  const base = Layer.mergeAll(
    LoggerLive,
    MinLogLevelLive,
    TracingLayer(env, fetchFn, request)
  );
  return request ? requestLayer(request).pipe(Layer.provideMerge(base)) : base;
};

export const makeAppRuntime = (
  env: Env,
  auth: AuthRuntimeOptions,
  request?: RequestContext,
  errorReporter: ErrorReporterShape = requestErrorReporter(env, request)
) => {
  const baseLayer = Layer.mergeAll(
    DatabaseLive,
    BucketLive,
    AuthApiLive(auth),
    AnalyticsLive,
    RateLimiterLive,
    ErrorReporterFrom(errorReporter)
  );
  const reposLayer = Layer.mergeAll(
    UserRepository.Default,
    AnalyticsRepository.Default,
    BucketRepository.Default,
    HealthRepository.Default
  );
  const layer = reposLayer
    .pipe(Layer.provideMerge(baseLayer))
    .pipe(Layer.provide(CloudflareEnvLive(env)))
    .pipe(Layer.provideMerge(observabilityLayer(env, request)));
  return ManagedRuntime.make(layer);
};

export type AppRuntime = ReturnType<typeof makeAppRuntime>;
