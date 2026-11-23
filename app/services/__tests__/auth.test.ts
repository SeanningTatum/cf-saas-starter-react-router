import { describe, expect, vi } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Exit, Cause, Layer, Option } from "effect";
import type { AuthConfig } from "@/auth/config";
import { TURNSTILE_TEST_SITE_KEY } from "@/lib/constants/turnstile";

const SECRET = "auth-service-test-secret-not-real-000000";
const THROWING_SECRET = "auth-service-test-secret-makes-createauth-throw";

vi.mock("@/auth/server", () => ({
  createAuth: vi.fn((_db: unknown, config: AuthConfig) => {
    if (config.secret === THROWING_SECRET) throw new Error("createAuth boom");
    return { api: { tag: "api", config } };
  }),
}));

import { AuthApi, AuthApiLive } from "../auth";
import { CloudflareEnv } from "../cloudflare";
import { ConfigurationError, ExternalServiceError } from "@/models/errors/repository";

const envLayer = (env: Partial<Env>) => Layer.succeed(CloudflareEnv, env as Env);

const prodEnv = {
  DATABASE: {} as D1Database,
  BETTER_AUTH_SECRET: SECRET,
  BETTER_AUTH_URL: "https://app.example.test",
};

const configOf = (env: Partial<Env>, options: Parameters<typeof AuthApiLive>[0]) =>
  Effect.gen(function* () {
    const { api } = yield* AuthApi;
    return (api as unknown as { config: AuthConfig }).config;
  }).pipe(Effect.provide(AuthApiLive(options).pipe(Layer.provide(envLayer(env)))));

const siteKeyOf = (env: Partial<Env>, options: Parameters<typeof AuthApiLive>[0]) =>
  Effect.map(
    AuthApi.pipe(Effect.provide(AuthApiLive(options).pipe(Layer.provide(envLayer(env))))),
    (service) => service.turnstileSiteKey,
  );

const failureOf = (env: Partial<Env>, options: Parameters<typeof AuthApiLive>[0]) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(configOf(env, options));
    expect(Exit.isFailure(exit)).toBe(true);
    return Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none();
  });

describe("AuthApiLive", () => {
  it.effect("provides api built from the env's config when createAuth succeeds", () =>
    Effect.gen(function* () {
      const config = yield* configOf(prodEnv, { dev: false });
      expect(config).toEqual({
        secret: SECRET,
        baseURL: "https://app.example.test",
        trustedOrigins: [],
        secureCookies: true,
        turnstile: null,
      });
    }),
  );

  it.effect("passes the request origin through to createAuth in dev", () =>
    Effect.gen(function* () {
      const config = yield* configOf(prodEnv, {
        dev: true,
        requestOrigin: "http://localhost:5173",
      });
      expect(config.baseURL).toBe("http://localhost:5173");
      expect(config.secureCookies).toBe(false);
    }),
  );

  it.effect(
    "ignores the request origin outside dev, so a forged Host cannot move the base URL",
    () =>
      Effect.gen(function* () {
        const config = yield* configOf(prodEnv, {
          dev: false,
          requestOrigin: "https://spoofed.test",
        });
        expect(config.baseURL).toBe("https://app.example.test");
      }),
  );

  it.effect("fails with the ConfigurationError when the config is bad, not a later crash", () =>
    Effect.gen(function* () {
      const failure = yield* failureOf(
        { DATABASE: {} as D1Database, BETTER_AUTH_SECRET: SECRET },
        { dev: false, requestOrigin: "https://app.example.test" },
      );
      expect(Option.isSome(failure)).toBe(true);
      if (Option.isSome(failure)) {
        expect(failure.value).toBeInstanceOf(ConfigurationError);
        expect(failure.value).toMatchObject({
          service: "BetterAuth",
          field: "BETTER_AUTH_URL",
        });
      }
    }),
  );

  it.effect(
    "hands the configured Turnstile site key to loaders, so the widget and the server use one pair",
    () =>
      Effect.gen(function* () {
        const siteKey = yield* siteKeyOf(
          {
            ...prodEnv,
            TURNSTILE_SITE_KEY: "0x4AAAAAAA-fake-site-key",
            TURNSTILE_SECRET_KEY: "0x4AAAAAAA-fake-secret",
          },
          { dev: false },
        );
        expect(siteKey).toBe("0x4AAAAAAA-fake-site-key");
      }),
  );

  it.effect("gives a null site key when Turnstile is off, so the forms render no widget", () =>
    Effect.gen(function* () {
      expect(yield* siteKeyOf(prodEnv, { dev: false })).toBeNull();
    }),
  );

  it.effect("gives the always-pass test site key in dev when no keys are set", () =>
    Effect.gen(function* () {
      expect(yield* siteKeyOf(prodEnv, { dev: true })).toBe(TURNSTILE_TEST_SITE_KEY);
    }),
  );

  it.effect("fails with ExternalServiceError when createAuth throws", () =>
    Effect.gen(function* () {
      const failure = yield* failureOf(
        { ...prodEnv, BETTER_AUTH_SECRET: THROWING_SECRET },
        { dev: false },
      );
      expect(Option.isSome(failure)).toBe(true);
      if (Option.isSome(failure)) {
        expect(failure.value).toBeInstanceOf(ExternalServiceError);
        expect((failure.value as ExternalServiceError).service).toBe("BetterAuth");
      }
    }),
  );
});
