import { Context, Effect, Layer } from "effect";
import { AuthApi } from "./auth";
import { ExternalServiceError } from "@/models/errors/repository";

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
      if (!result) {
        return { session: null, user: null };
      }
      return {
        session: result.session as SessionInfo,
        user: result.user as SessionUser,
      };
    })
  );
