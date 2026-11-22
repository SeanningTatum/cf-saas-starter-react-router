import { Clock, Context, Effect, Layer } from "effect";
import { AuthApi } from "./auth";
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

export const SessionLive = (headers: Headers) =>
  Layer.effect(
    Session,
    Effect.gen(function* () {
      const { api } = yield* AuthApi;
      const result = yield* Effect.tryPromise({
        try: () => api.getSession({ headers }),
        catch: (cause) =>
          new ExternalServiceError({ service: "BetterAuth", cause }),
      });
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
