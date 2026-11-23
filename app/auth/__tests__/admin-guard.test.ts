import { describe, expect, it } from "vitest";
import { APIError } from "better-auth/api";
import {
  ADMIN_GUARD_REFUSALS,
  ADMIN_PATHS_REVIEWED_AS_OPEN,
  ADMIN_PATHS_TARGETING_SESSION_TOKEN,
  ADMIN_PATHS_TARGETING_USER_ID,
} from "@/lib/constants/admin";
import {
  isAdminPath,
  readAdminTarget,
  refusalError,
  withEmailVerificationReset,
} from "../admin-guard";

describe("readAdminTarget", () => {
  it.each(ADMIN_PATHS_TARGETING_USER_ID.map((path) => [path]))(
    "%s: reads the target user id",
    (path) => {
      expect(readAdminTarget(path, { userId: "u1", role: "admin" })).toEqual({
        _tag: "User",
        userId: "u1",
      });
    },
  );

  it("reads a number id the way Better Auth coerces it, so a number cannot slip past the guard", () => {
    expect(readAdminTarget("/admin/ban-user", { userId: 42 })).toEqual({
      _tag: "User",
      userId: "42",
    });
  });

  it.each([
    ["no body", undefined],
    ["no userId", { role: "user" }],
    ["a userId that is an object", { userId: { id: "u1" } }],
    ["a userId that is a list", { userId: ["u1"] }],
  ])("refuses to guess the target from %s", (_label, body) => {
    expect(readAdminTarget("/admin/set-role", body)).toEqual({ _tag: "Unreadable" });
  });

  it.each(ADMIN_PATHS_TARGETING_SESSION_TOKEN.map((path) => [path]))(
    "%s: reads the target session token",
    (path) => {
      expect(readAdminTarget(path, { sessionToken: "tok" })).toEqual({
        _tag: "Session",
        sessionToken: "tok",
      });
      expect(readAdminTarget(path, {})).toEqual({ _tag: "Unreadable" });
    },
  );

  it.each([...ADMIN_PATHS_REVIEWED_AS_OPEN, "/sign-in/email", "/get-session"].map((p) => [p]))(
    "%s: is left to Better Auth's own checks",
    (path) => {
      expect(readAdminTarget(path, { userId: "u1" })).toEqual({ _tag: "Open" });
    },
  );
});

describe("isAdminPath", () => {
  it.each(
    [
      ...ADMIN_PATHS_TARGETING_USER_ID,
      ...ADMIN_PATHS_TARGETING_SESSION_TOKEN,
      ...ADMIN_PATHS_REVIEWED_AS_OPEN,
    ].map((p) => [p]),
  )("%s: counts as an admin path, so a banned admin is refused there too", (path) => {
    expect(isAdminPath(path)).toBe(true);
  });

  it.each(["/sign-in/email", "/get-session", "/update-user", "/admin"].map((p) => [p]))(
    "%s: is not an admin path, so the guard skips the session read",
    (path) => {
      expect(isAdminPath(path)).toBe(false);
    },
  );
});

describe("withEmailVerificationReset", () => {
  it("marks the email unverified when the update changes it, whatever the caller sent", () => {
    expect(
      withEmailVerificationReset(
        { userId: "u1", data: { email: "new@example.test", emailVerified: true, name: "N" } },
        "old@example.test",
      ),
    ).toEqual({ data: { email: "new@example.test", emailVerified: false, name: "N" } });
  });

  it("leaves the update alone when the email stays the same", () => {
    expect(
      withEmailVerificationReset(
        { data: { email: "same@example.test", emailVerified: true } },
        "same@example.test",
      ),
    ).toBeNull();
  });

  it("leaves the update alone when it does not touch the email", () => {
    expect(withEmailVerificationReset({ data: { name: "N" } }, "a@example.test")).toBeNull();
  });

  it.each([undefined, null, "text", { data: "not a record" }])(
    "leaves a body it cannot read to the endpoint's own check: %s",
    (body) => {
      expect(withEmailVerificationReset(body, "a@example.test")).toBeNull();
    },
  );
});

describe("refusalError", () => {
  it.each([
    { refusal: ADMIN_GUARD_REFUSALS.protectedTarget, status: 403 },
    { refusal: ADMIN_GUARD_REFUSALS.bannedCaller, status: 401 },
    { refusal: ADMIN_GUARD_REFUSALS.unreadableTarget, status: 400 },
  ])("$refusal.code answers HTTP $status", ({ refusal, status }) => {
    const error = refusalError(refusal);
    expect(error).toBeInstanceOf(APIError);
    expect(error.statusCode).toBe(status);
    expect(error.body).toMatchObject({ code: refusal.code, message: refusal.message });
  });
});
