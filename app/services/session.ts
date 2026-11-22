import { Clock, Context, Effect, Layer } from "effect";
import { AuthApi } from "./auth";
import { AUTH_GET_SESSION_SPAN } from "@/lib/constants/spans";
import { ExternalServiceError } from "@/models/errors/repository";
import { activeSession } from "@/auth/ban";

type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: string | null | undefined;
  banned: boolean | null | undefined;
  banReason: string | null | undefined;
  banExpires: Date | null | undefined;
  emailVerified: boolean;
  image: string | null | undefined;
  createdAt: Date;
  updatedAt: Date;
};

type SessionInfo = {
  id: string;
  userId: string;
  expiresAt: Date;
  token: string;
};

export interface SessionShape {
  readonly session: SessionInfo | null;
  readonly user: SessionUser | null;
}

export class Session extends Context.Tag("app/Session")<
  Session,
  SessionShape
>() {}

export const getSession = <A>(
  api: { readonly getSession: (input: { headers: Headers }) => Promise<A> },
  headers: Headers
): Effect.Effect<A, ExternalServiceError> =>
  Effect.tryPromise({
    try: () => api.getSession({ headers }),
    catch: (cause) => new ExternalServiceError({ service: "BetterAuth", cause }),
  }).pipe(Effect.withSpan(AUTH_GET_SESSION_SPAN, { kind: "client" }));

export const SessionLive = (headers: Headers) =>
  Layer.effect(
    Session,
    Effect.gen(function* () {
      const { api } = yield* AuthApi;
      const result = yield* getSession(api, headers);
      const live = activeSession(result, new Date(yield* Clock.currentTimeMillis));
      if (!live) {
        return { session: null, user: null };
      }
      return {
        session: live.session as SessionInfo,
        user: live.user as SessionUser,
      };
    })
  );
