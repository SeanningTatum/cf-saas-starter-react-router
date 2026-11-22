import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Exit, Cause, Layer, TestClock } from "effect";
import { Session, SessionLive } from "../session";
import { AuthApi } from "../auth";
import { ExternalServiceError } from "@/models/errors/repository";

type Api = { getSession: (opts: { headers: Headers }) => Promise<unknown> };

const authLayer = (api: Api) =>
  Layer.succeed(AuthApi, {
    auth: {} as never,
    api: api as never,
    turnstileSiteKey: null,
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

  describe("with a banned user", () => {
    const NOW = new Date("2030-06-15T12:00:00Z");
    const sessionFor = (ban: { banned: boolean; banExpires?: Date }) => ({
      getSession: async () => ({
        session: { id: "s1", userId: "u1", expiresAt: new Date(), token: "t" },
        user: {
          id: "u1",
          email: "a@b.c",
          name: "A",
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...ban,
        },
      }),
    });
    const resolveAt = (api: Api) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW.getTime());
        return yield* Session.pipe(Effect.provide(provide(api)));
      });

    it.effect("gives no session to a user whose ban has no end", () =>
      Effect.gen(function* () {
        const { session, user } = yield* resolveAt(sessionFor({ banned: true }));
        expect(session).toBeNull();
        expect(user).toBeNull();
      })
    );

    it.effect("gives no session to a user whose ban ends later", () =>
      Effect.gen(function* () {
        const { session, user } = yield* resolveAt(
          sessionFor({ banned: true, banExpires: new Date("2030-06-15T12:00:01Z") })
        );
        expect(session).toBeNull();
        expect(user).toBeNull();
      })
    );

    it.effect("lets the session through once the ban has run out, by the Effect clock", () =>
      Effect.gen(function* () {
        const { session, user } = yield* resolveAt(
          sessionFor({ banned: true, banExpires: new Date("2030-06-15T11:59:59Z") })
        );
        expect(session?.id).toBe("s1");
        expect(user?.id).toBe("u1");
      })
    );
  });
});
