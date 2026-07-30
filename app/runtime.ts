import { Layer, ManagedRuntime } from "effect";
import { CloudflareEnvLive } from "@/services/cloudflare";
import { DatabaseLive, type Database } from "@/services/database";
import { BucketLive, type Bucket } from "@/services/bucket";
import { AuthApiLive, type AuthApi as AuthApiTag } from "@/services/auth";
import { WorkflowsLive, type Workflows } from "@/services/workflows";
import { LoggerLive, MinLogLevelLive } from "@/services/logger";
import { TracingLayer } from "@/services/tracing";
import { UserRepository } from "@/repositories/user";
import { AnalyticsRepository } from "@/repositories/analytics";
import { BucketRepository } from "@/repositories/bucket";

export type AppServices =
  | Database
  | Bucket
  | AuthApiTag
  | Workflows
  | UserRepository
  | AnalyticsRepository
  | BucketRepository;

// `baseURL` is the request's own origin — threaded through to Better Auth
// via `AuthApiLive(baseURL)` so the single construction path (Effect.try →
// ExternalServiceError, unit-tested in services/__tests__/auth.test.ts) is
// used in production too. No more raw `createAuth(...)` call outside Effect.
export const makeAppRuntime = (env: Env, baseURL?: string) => {
  const baseLayer = Layer.mergeAll(
    DatabaseLive,
    BucketLive,
    AuthApiLive(baseURL),
    WorkflowsLive
  );
  const reposLayer = Layer.mergeAll(
    UserRepository.Default,
    AnalyticsRepository.Default,
    BucketRepository.Default
  );
  const layer = reposLayer
    .pipe(Layer.provideMerge(baseLayer))
    .pipe(Layer.provide(CloudflareEnvLive(env)))
    .pipe(
      Layer.provideMerge(
        Layer.mergeAll(LoggerLive, MinLogLevelLive, TracingLayer(env))
      )
    );
  return ManagedRuntime.make(layer);
};

export type AppRuntime = ReturnType<typeof makeAppRuntime>;
