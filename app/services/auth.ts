import { Context, Effect, Layer } from "effect";
import { resolveAuthConfig, type AuthRuntimeOptions } from "@/auth/config";
import { createAuth, type Auth } from "@/auth/server";
import { CloudflareEnv, CloudflareEnvLive } from "./cloudflare";
import { ExternalServiceError } from "@/models/errors/repository";
import { DatabaseLive } from "./database";
import { BucketLive } from "./bucket";
import { UploadRepository } from "@/repositories/upload";

const purgeUploadsFor = (env: Env) => {
  if (!(env as Env & { BUCKET?: R2Bucket }).BUCKET) return undefined;
  const layer = UploadRepository.Default.pipe(
    Layer.provide(Layer.mergeAll(DatabaseLive, BucketLive)),
    Layer.provide(CloudflareEnvLive(env)),
  );
  return (userId: string) =>
    Effect.runPromise(
      Effect.flatMap(UploadRepository, (uploads) => uploads.purgeForUsers([userId])).pipe(
        Effect.provide(layer),
      ),
    );
};

export interface AuthApiShape {
  readonly auth: Auth;
  readonly api: Auth["api"];
  readonly turnstileSiteKey: string | null;
}

export class AuthApi extends Context.Tag("app/AuthApi")<AuthApi, AuthApiShape>() {}

export const AuthApiLive = (options: AuthRuntimeOptions) =>
  Layer.effect(
    AuthApi,
    Effect.gen(function* () {
      const env = yield* CloudflareEnv;
      const config = yield* resolveAuthConfig(env, options);
      const auth = yield* Effect.try({
        try: () => createAuth(env.DATABASE, config, purgeUploadsFor(env)),
        catch: (cause) => new ExternalServiceError({ service: "BetterAuth", cause }),
      });
      return { auth, api: auth.api, turnstileSiteKey: config.turnstile?.siteKey ?? null };
    }),
  );
