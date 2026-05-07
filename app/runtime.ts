import { Layer, ManagedRuntime } from "effect";
import type { Auth } from "@/auth/server";
import { CloudflareEnvLive } from "@/services/cloudflare";
import { DatabaseLive, type Database } from "@/services/database";
import { BucketLive, type Bucket } from "@/services/bucket";
import {
  AuthApi,
  AuthApiLive,
  type AuthApi as AuthApiTag,
} from "@/services/auth";
import { WorkflowsLive, type Workflows } from "@/services/workflows";
import { LoggerLive, MinLogLevelLive } from "@/services/logger";
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

export const makeAppRuntime = (env: Env, auth?: Auth) => {
  const authLayer = auth
    ? Layer.succeed(AuthApi, { auth, api: auth.api })
    : AuthApiLive;
  const baseLayer = Layer.mergeAll(
    DatabaseLive,
    BucketLive,
    authLayer,
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
    .pipe(Layer.provideMerge(Layer.merge(LoggerLive, MinLogLevelLive)));
  return ManagedRuntime.make(layer);
};

export type AppRuntime = ReturnType<typeof makeAppRuntime>;
