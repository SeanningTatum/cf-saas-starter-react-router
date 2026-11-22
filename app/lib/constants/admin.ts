export const ADMIN_ROLE = "admin";
export const ROLE_LIST_SEPARATOR = ",";

export const PROTECTED_USER_MESSAGE = "Cannot modify admin users or yourself";

export const ADMIN_UPDATE_USER_PATH = "/admin/update-user";

export const ADMIN_PATHS_TARGETING_USER_ID: ReadonlyArray<string> = [
  "/admin/set-role",
  ADMIN_UPDATE_USER_PATH,
  "/admin/ban-user",
  "/admin/impersonate-user",
  "/admin/revoke-user-sessions",
  "/admin/remove-user",
  "/admin/set-user-password",
  "/admin/list-user-sessions",
];

export const ADMIN_PATHS_TARGETING_SESSION_TOKEN: ReadonlyArray<string> = [
  "/admin/revoke-user-session",
];

export const ADMIN_PATHS_REVIEWED_AS_OPEN: ReadonlyArray<string> = [
  "/admin/unban-user",
  "/admin/create-user",
  "/admin/get-user",
  "/admin/list-users",
  "/admin/stop-impersonating",
  "/admin/has-permission",
];

export const ADMIN_GUARD_REFUSALS = {
  protectedTarget: {
    status: "FORBIDDEN",
    code: "PROTECTED_USER",
    message: PROTECTED_USER_MESSAGE,
  },
  bannedCaller: {
    status: "UNAUTHORIZED",
    code: "BANNED_USER",
    message: "This account is banned",
  },
  unreadableTarget: {
    status: "BAD_REQUEST",
    code: "TARGET_REQUIRED",
    message: "Name the user to act on",
  },
} as const;
