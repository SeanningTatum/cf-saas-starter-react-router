import { Context, Effect, Layer } from "effect";
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

// `baseURL` is request-scoped (the request's own origin) rather than
// env-scoped, so `AuthApiLive` is a factory — mirrors `SessionLive(headers)`.
export const AuthApiLive = (baseURL?: string) =>
  Layer.effect(
    AuthApi,
    Effect.gen(function* () {
      const env = yield* CloudflareEnv;
      const auth = yield* Effect.try({
        try: () => createAuth(env.DATABASE, env.BETTER_AUTH_SECRET, baseURL),
        catch: (cause) =>
          new ExternalServiceError({ service: "BetterAuth", cause }),
      });
      return { auth, api: auth.api };
    })
  );
