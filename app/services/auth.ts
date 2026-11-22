import { Context, Effect, Layer } from "effect";
import { resolveAuthConfig, type AuthRuntimeOptions } from "@/auth/config";
import { createAuth, type Auth } from "@/auth/server";
import { CloudflareEnv } from "./cloudflare";
import { ExternalServiceError } from "@/models/errors/repository";

export interface AuthApiShape {
  readonly auth: Auth;
  readonly api: Auth["api"];
}

export class AuthApi extends Context.Tag("app/AuthApi")<
  AuthApi,
  AuthApiShape
>() {}

export const AuthApiLive = (options: AuthRuntimeOptions) =>
  Layer.effect(
    AuthApi,
    Effect.gen(function* () {
      const env = yield* CloudflareEnv;
      const config = yield* resolveAuthConfig(env, options);
      const auth = yield* Effect.try({
        try: () => createAuth(env.DATABASE, config),
        catch: (cause) =>
          new ExternalServiceError({ service: "BetterAuth", cause }),
      });
      return { auth, api: auth.api };
    })
  );
