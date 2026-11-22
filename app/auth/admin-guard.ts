import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import type { GenericEndpointContext } from "better-auth";
import { Option, Schema } from "effect";
import {
  ADMIN_GUARD_REFUSALS,
  ADMIN_PATHS_TARGETING_SESSION_TOKEN,
  ADMIN_PATHS_TARGETING_USER_ID,
  ADMIN_UPDATE_USER_PATH,
} from "@/lib/constants/admin";
import { isBanActive, type BanFields } from "./ban";
import { isEmailChange } from "./email-change";
import { hasAdminRole, isProtectedUser } from "./protected-user";

export type AdminTarget =
  | { readonly _tag: "Open" }
  | { readonly _tag: "Unreadable" }
  | { readonly _tag: "User"; readonly userId: string }
  | { readonly _tag: "Session"; readonly sessionToken: string };

export type AdminGuardRefusal =
  (typeof ADMIN_GUARD_REFUSALS)[keyof typeof ADMIN_GUARD_REFUSALS];

type NamedTarget = Extract<AdminTarget, { _tag: "User" | "Session" }>;
type InternalAdapter = GenericEndpointContext["context"]["internalAdapter"];

const UserIdBody = Schema.Struct({
  userId: Schema.Union(Schema.String, Schema.Number),
});
const SessionTokenBody = Schema.Struct({ sessionToken: Schema.String });
const UserDataBody = Schema.Struct({
  data: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

export const readAdminTarget = (path: string, body: unknown): AdminTarget => {
  if (ADMIN_PATHS_TARGETING_USER_ID.includes(path)) {
    return Option.match(Schema.decodeUnknownOption(UserIdBody)(body), {
      onNone: (): AdminTarget => ({ _tag: "Unreadable" }),
      onSome: ({ userId }): AdminTarget => ({ _tag: "User", userId: String(userId) }),
    });
  }
  if (ADMIN_PATHS_TARGETING_SESSION_TOKEN.includes(path)) {
    return Option.match(Schema.decodeUnknownOption(SessionTokenBody)(body), {
      onNone: (): AdminTarget => ({ _tag: "Unreadable" }),
      onSome: ({ sessionToken }): AdminTarget => ({ _tag: "Session", sessionToken }),
    });
  }
  return { _tag: "Open" };
};

export const withEmailVerificationReset = (
  body: unknown,
  storedEmail: string
): { readonly data: Record<string, unknown> } | null =>
  Option.match(Schema.decodeUnknownOption(UserDataBody)(body), {
    onNone: () => null,
    onSome: ({ data }) =>
      isEmailChange(storedEmail, data.email)
        ? { data: { ...data, emailVerified: false } }
        : null,
  });

export const refusalError = (refusal: AdminGuardRefusal): APIError =>
  new APIError(refusal.status, { code: refusal.code, message: refusal.message });

const findTargetUser = async (internalAdapter: InternalAdapter, target: NamedTarget) =>
  target._tag === "User"
    ? internalAdapter.findUserById(target.userId)
    : ((await internalAdapter.findSession(target.sessionToken))?.user ?? null);

export const adminGuard = createAuthMiddleware(async (ctx) => {
  const target = readAdminTarget(ctx.path, ctx.body);
  if (target._tag === "Open") return;

  const session = await getSessionFromCtx(ctx);
  if (!session || !hasAdminRole(session.user.role)) return;
  const callerBan: BanFields = {
    banned: session.user.banned,
    banExpires: session.user.banExpires,
  };
  if (isBanActive(callerBan, new Date())) {
    return Promise.reject(refusalError(ADMIN_GUARD_REFUSALS.bannedCaller));
  }
  if (target._tag === "Unreadable") {
    return Promise.reject(refusalError(ADMIN_GUARD_REFUSALS.unreadableTarget));
  }

  const callerId = session.user.id;
  const user = await findTargetUser(ctx.context.internalAdapter, target);
  const isProtected = user
    ? isProtectedUser(user, callerId)
    : target._tag === "User" && target.userId === callerId;
  if (isProtected) {
    return Promise.reject(refusalError(ADMIN_GUARD_REFUSALS.protectedTarget));
  }

  if (ctx.path !== ADMIN_UPDATE_USER_PATH || !user) return;
  const body = withEmailVerificationReset(ctx.body, user.email);
  return body ? { context: { body } } : undefined;
});
