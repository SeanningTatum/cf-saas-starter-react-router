import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Exit, Cause, Layer } from "effect";
import { Session, SessionLive } from "../session";
import { AuthApi } from "../auth";
import { ExternalServiceError } from "@/models/errors/repository";

type Api = { getSession: (opts: { headers: Headers }) => Promise<unknown> };

const authLayer = (api: Api) =>
  Layer.succeed(AuthApi, {
    auth: {} as never,
    api: api as never,
  });

const provide = (api: Api) =>
  SessionLive(new Headers()).pipe(Layer.provide(authLayer(api)));

describe("SessionLive", () => {
  it.effect("returns null pair when getSession resolves null", () =>
    Effect.gen(function* () {
      const { session, user } = yield* Session;
      expect(session).toBeNull();
      expect(user).toBeNull();
    }).pipe(Effect.provide(provide({ getSession: async () => null })))
  );

  it.effect("returns session + user when present", () =>
    Effect.gen(function* () {
      const { session, user } = yield* Session;
      expect(session?.id).toBe("s1");
      expect(user?.email).toBe("a@b.c");
    }).pipe(
      Effect.provide(
        provide({
          getSession: async () => ({
            session: {
              id: "s1",
              userId: "u1",
              expiresAt: new Date(),
              token: "t",
            },
            user: {
              id: "u1",
              email: "a@b.c",
              name: "A",
              emailVerified: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          }),
        })
      )
    )
  );

  it.effect("fails with ExternalServiceError when getSession throws", () =>
    Effect.gen(function* () {
      const program = Session.pipe(
        Effect.provide(
          provide({
            getSession: async () => {
              throw new Error("auth down");
            },
          })
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
