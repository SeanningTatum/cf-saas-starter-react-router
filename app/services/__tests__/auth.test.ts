import { describe, expect, vi } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Exit, Cause, Layer } from "effect";

vi.mock("@/auth/server", () => ({
  createAuth: vi.fn((_db: unknown, secret: string) => {
    if (secret === "throw") throw new Error("createAuth boom");
    return { api: { tag: "api", secret } };
  }),
}));

import { AuthApi, AuthApiLive } from "../auth";
import { CloudflareEnv } from "../cloudflare";
import { ExternalServiceError } from "@/models/errors/repository";

const envLayer = (env: Partial<Env>) =>
  Layer.succeed(CloudflareEnv, env as Env);

describe("AuthApiLive", () => {
  it.effect("provides api when createAuth succeeds", () =>
    Effect.gen(function* () {
      const { api } = yield* AuthApi;
      expect((api as unknown as { tag: string }).tag).toBe("api");
    }).pipe(
      Effect.provide(
        AuthApiLive.pipe(
          Layer.provide(
            envLayer({
              DATABASE: {} as D1Database,
              BETTER_AUTH_SECRET: "ok",
            })
          )
        )
      )
    )
  );

  it.effect("fails with ExternalServiceError when createAuth throws", () =>
    Effect.gen(function* () {
      const program = AuthApi.pipe(
        Effect.provide(
          AuthApiLive.pipe(
            Layer.provide(
              envLayer({
                DATABASE: {} as D1Database,
                BETTER_AUTH_SECRET: "throw",
              })
            )
          )
        )
      );
      const exit = yield* Effect.exit(program);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        if (failure._tag === "Some") {
          expect(failure.value).toBeInstanceOf(ExternalServiceError);
          expect((failure.value as ExternalServiceError).service).toBe(
            "BetterAuth"
          );
        }
      }
    })
  );
});
