import { Layer, ManagedRuntime, Tracer } from "effect";
import { CloudflareEnvLive } from "@/services/cloudflare";
import { DatabaseLive, type Database } from "@/services/database";
import { BucketLive, type Bucket } from "@/services/bucket";
import { AuthApiLive, type AuthApi as AuthApiTag } from "@/services/auth";
import type { AuthRuntimeOptions } from "@/auth/config";
import { LoggerLive, MinLogLevelLive } from "@/services/logger";
import { AnalyticsLive, type Analytics } from "@/services/analytics";
import { RateLimiterLive, type RateLimiter } from "@/services/rate-limit";
import { TracingLayer, type FetchLike } from "@/services/tracing";
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
  | UserRepository
  | AnalyticsRepository
  | BucketRepository
  | HealthRepository;

/**
 * The request's part of the runtime: `CurrentRequest`, and one server span
 * for the whole request. `Layer.span` provides `Tracer.ParentSpan`, so every
 * `Effect.withSpan` run through the runtime becomes its child: one trace per
 * request, continuing the caller's trace when a valid `traceparent` came in.
 * Effect logs outside any `withSpan` also carry this span's ids.
 * `request.id` is not set here: the tracer stamps it on every span, this one
 * included (see `makeOtlpTracer`), so it has one source.
 */
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
        "url.path": request.path,
      },
    })
  );

/**
 * Logger, log level and tracer, with the request part built on top. Order
 * matters twice: the request span is built after `TracingLayer` has set the
 * tracer (or it would go to Effect's default tracer and never be exported),
 * and it ends before `TracingLayer`'s flush finalizer runs on
 * `runtime.dispose()` (or it would end after the flush and be lost).
 * `Layer.provideMerge` gives both: the provider is built first and released
 * last. The tracer gets the request too, to stamp its ids on every span.
 * `fetchFn` is the tracing test seam.
 */
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
  // Typed as `Layer<never>` on purpose: without `request` the runtime holds
  // neither service, so its type must not promise them. Code that wants the
  // request reads it with `Effect.serviceOption(CurrentRequest)`.
  return request ? requestLayer(request).pipe(Layer.provideMerge(base)) : base;
};

export const makeAppRuntime = (
  env: Env,
  auth: AuthRuntimeOptions,
  request?: RequestContext
) => {
  const baseLayer = Layer.mergeAll(
    DatabaseLive,
    BucketLive,
    AuthApiLive(auth),
    AnalyticsLive,
    RateLimiterLive
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
