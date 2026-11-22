import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Exit, Cause, Layer, Option, TestClock } from "effect";
import { Session, SessionLive, getSession } from "../session";
import { AuthApi } from "../auth";
import { makeOtlpTracer, makeSpanBuffer } from "../tracing";
import { isErrorSpan } from "../tracing-otlp";
import { AUTH_GET_SESSION_SPAN } from "@/lib/constants/spans";
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

  it.effect("records its lookup as an auth.get_session span, so the layer cannot bypass the traced lookup", () => {
    const buffer = makeSpanBuffer();
    return Session.pipe(
      Effect.provide(provide({ getSession: async () => null })),
      Effect.withTracer(makeOtlpTracer(buffer)),
      Effect.map(() => {
        expect(buffer.spans.map((span) => span.name)).toEqual([AUTH_GET_SESSION_SPAN]);
      })
    );
  });

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

describe("getSession", () => {
  it.effect("records one auth.get_session client span that ends ok, so a slow session lookup shows in the trace", () => {
    const buffer = makeSpanBuffer();
    return getSession({ getSession: async () => null }, new Headers()).pipe(
      Effect.withTracer(makeOtlpTracer(buffer)),
      Effect.map(() => {
        expect(buffer.spans).toHaveLength(1);
        const [span] = buffer.spans;
        expect(span?.name).toBe(AUTH_GET_SESSION_SPAN);
        expect(span?.kind).toBe("client");
        expect(span && isErrorSpan(span)).toBe(false);
      })
    );
  });

  it.effect("ends the span as failed and fails with ExternalServiceError when Better Auth throws, so an auth outage shows red and maps to 503", () => {
    const buffer = makeSpanBuffer();
    const failing = {
      getSession: async (): Promise<null> => {
        throw new Error("auth down");
      },
    };
    return Effect.gen(function* () {
      const exit = yield* Effect.exit(getSession(failing, new Headers()));

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        expect(Option.getOrUndefined(failure)).toBeInstanceOf(ExternalServiceError);
      }
      expect(buffer.spans.map((span) => [span.name, isErrorSpan(span)])).toEqual([
        [AUTH_GET_SESSION_SPAN, true],
      ]);
    }).pipe(Effect.withTracer(makeOtlpTracer(buffer)));
  });

  it.effect("passes the request headers to Better Auth, so the lookup reads the caller's cookie", () => {
    const headers = new Headers({ cookie: "sid=fake" });
    const seen: Headers[] = [];
    return getSession(
      {
        getSession: async (input: { headers: Headers }) => {
          seen.push(input.headers);
          return null;
        },
      },
      headers
    ).pipe(
      Effect.map(() => {
        expect(seen).toHaveLength(1);
        expect(seen[0]).toBe(headers);
      })
    );
  });
});
