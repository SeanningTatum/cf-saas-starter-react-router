import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BASE_URL, startRealApp, type Account, type RealApp } from "./real-d1";

vi.mock("@/lib/log-format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log-format")>()),
  isDev: false,
}));

const AUTH_PREFIX = "/api/auth";
const NEW_PASSWORD = "another-correct-horse-battery";

let app: RealApp;
let admin: Account;
let userCount = 0;

const freshUser = () => app.signUp(`plain${++userCount}@rules.test`);
const freshAdmin = () => app.signUpAdmin(`admin${++userCount}@rules.test`);

const callAuth = (path: string, headers: Headers, body: unknown): Promise<Response> =>
  app.auth.handler(
    new Request(`${BASE_URL}${AUTH_PREFIX}${path}`, {
      method: "POST",
      headers: {
        cookie: headers.get("cookie") ?? "",
        origin: BASE_URL,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    })
  );

const rowOf = (userId: string) =>
  app.db
    .prepare(
      `SELECT u.role, u.banned, u.name, u.email, u.email_verified AS emailVerified,
              (SELECT count(*) FROM session s WHERE s.user_id = u.id) AS sessions,
              (SELECT a.password FROM account a WHERE a.user_id = u.id) AS password
         FROM user u WHERE u.id = ?`
    )
    .bind(userId)
    .first();

const sessionRows = async (userId: string) =>
  (await rowOf(userId))?.sessions;

type Action = { readonly path: string; readonly body: (userId: string) => unknown };

const ACTIONS: ReadonlyArray<Action> = [
  { path: "/admin/ban-user", body: (userId) => ({ userId }) },
  { path: "/admin/set-role", body: (userId) => ({ userId, role: "user" }) },
  { path: "/admin/remove-user", body: (userId) => ({ userId }) },
  { path: "/admin/impersonate-user", body: (userId) => ({ userId }) },
  { path: "/admin/update-user", body: (userId) => ({ userId, data: { name: "Renamed" } }) },
  { path: "/admin/revoke-user-sessions", body: (userId) => ({ userId }) },
  { path: "/admin/set-user-password", body: (userId) => ({ userId, newPassword: NEW_PASSWORD }) },
  { path: "/admin/list-user-sessions", body: (userId) => ({ userId }) },
];

const refusalOf = async (res: Response) => ({
  status: res.status,
  code: ((await res.json()) as { code?: string }).code,
});

const PROTECTED = { status: 403, code: "PROTECTED_USER" };

beforeAll(async () => {
  app = await startRealApp();
  admin = await app.signUpAdmin("caller@rules.test");
}, 60_000);

afterAll(async () => {
  await app?.dispose();
});

describe("Better Auth's admin endpoints follow the repository's rule", { timeout: 60_000 }, () => {
  it.each(ACTIONS)("$path on another admin is refused with 403 and the admin's row stays as it was", async ({ path, body }) => {
    const target = await freshAdmin();
    const before = await rowOf(target.userId);

    const res = await callAuth(path, admin.headers, body(target.userId));

    expect(await refusalOf(res)).toEqual(PROTECTED);
    expect(await rowOf(target.userId)).toEqual(before);
  });

  it("/admin/ban-user on the caller themself is refused with 403 and their row stays as it was", async () => {
    const self = await freshAdmin();
    const before = await rowOf(self.userId);

    const res = await callAuth("/admin/ban-user", self.headers, { userId: self.userId });

    expect(await refusalOf(res)).toEqual(PROTECTED);
    expect(await rowOf(self.userId)).toEqual(before);
  });

  it.each(ACTIONS)("$path on a plain user goes through", async ({ path, body }) => {
    const target = await freshUser();
    const res = await callAuth(path, admin.headers, body(target.userId));
    expect(res.status).toBe(200);
  });

  it("a refusal sends its own headers, not a copy of the request's", async () => {
    const target = await freshAdmin();
    const res = await callAuth("/admin/ban-user", admin.headers, { userId: target.userId });
    expect(res.status).toBe(403);
    expect(res.headers.get("cookie")).toBeNull();
    expect(res.headers.get("origin")).toBeNull();
  });

  it("revoking another admin's session by its token is refused and the session lives", async () => {
    const target = await freshAdmin();
    const token = (
      await app.db
        .prepare("SELECT token FROM session WHERE user_id = ? LIMIT 1")
        .bind(target.userId)
        .first<{ token: string }>()
    )?.token;
    const before = await sessionRows(target.userId);

    const res = await callAuth("/admin/revoke-user-session", admin.headers, { sessionToken: token });

    expect(await refusalOf(res)).toEqual(PROTECTED);
    expect(await sessionRows(target.userId)).toBe(before);
  });

  it("a user whose role list includes admin is protected too", async () => {
    const target = await freshUser();
    await app.db.prepare("UPDATE user SET role = 'user,admin' WHERE id = ?").bind(target.userId).run();

    const res = await callAuth("/admin/ban-user", admin.headers, { userId: target.userId });

    expect(await refusalOf(res)).toEqual(PROTECTED);
    expect((await rowOf(target.userId))?.banned).toBe(0);
  });

  it("a plain user gets the same refusal for an admin's id and a plain user's id, so the guard reveals nothing", async () => {
    const caller = await freshUser();
    const adminTarget = await freshAdmin();
    const plainTarget = await freshUser();

    const forAdmin = await callAuth("/admin/ban-user", caller.headers, { userId: adminTarget.userId });
    const forPlain = await callAuth("/admin/ban-user", caller.headers, { userId: plainTarget.userId });

    const refusal = { status: forAdmin.status, body: await forAdmin.json() };
    expect(refusal.status).toBe(403);
    expect({ status: forPlain.status, body: await forPlain.json() }).toEqual(refusal);
    expect((await rowOf(adminTarget.userId))?.banned).toBe(0);
    expect((await rowOf(plainTarget.userId))?.banned).toBe(0);
  });

  it("a body with no target is refused before the endpoint runs", async () => {
    const res = await callAuth("/admin/set-role", admin.headers, { role: "admin" });
    expect(await refusalOf(res)).toEqual({ status: 400, code: "TARGET_REQUIRED" });
  });

  it("an admin whose ban was set by hand cannot act through Better Auth", async () => {
    const bannedAdmin = await freshAdmin();
    const target = await freshUser();
    await app.db.prepare("UPDATE user SET banned = 1 WHERE id = ?").bind(bannedAdmin.userId).run();

    const res = await callAuth("/admin/ban-user", bannedAdmin.headers, { userId: target.userId });

    expect(await refusalOf(res)).toEqual({ status: 401, code: "BANNED_USER" });
    expect((await rowOf(target.userId))?.banned).toBe(0);
  });

  it("an admin whose ban was set by hand cannot lift their own ban through Better Auth", async () => {
    const bannedAdmin = await freshAdmin();
    await app.db.prepare("UPDATE user SET banned = 1 WHERE id = ?").bind(bannedAdmin.userId).run();

    const res = await callAuth("/admin/unban-user", bannedAdmin.headers, { userId: bannedAdmin.userId });

    expect(await refusalOf(res)).toEqual({ status: 401, code: "BANNED_USER" });
    expect((await rowOf(bannedAdmin.userId))?.banned).toBe(1);
  });

  it("an admin whose ban was set by hand cannot make a new admin through Better Auth", async () => {
    const bannedAdmin = await freshAdmin();
    await app.db.prepare("UPDATE user SET banned = 1 WHERE id = ?").bind(bannedAdmin.userId).run();
    const email = `spare${++userCount}@rules.test`;

    const res = await callAuth("/admin/create-user", bannedAdmin.headers, {
      email,
      name: "Spare",
      password: NEW_PASSWORD,
      role: "admin",
    });

    expect(await refusalOf(res)).toEqual({ status: 401, code: "BANNED_USER" });
    expect(await app.db.prepare("SELECT id FROM user WHERE email = ?").bind(email).first()).toBeNull();
  });
});

describe("tRPC admin procedures read the role list the way the guard does", { timeout: 60_000 }, () => {
  const adminCallOutcome = async (headers: Headers) =>
    (await app.callerFor(headers)).admin.getUsers({ page: 0, limit: 1 }).then(
      () => "ok",
      (e: unknown) => (e instanceof TRPCError ? e.code : `not a TRPCError: ${String(e)}`)
    );

  it("a user whose role list includes admin passes adminProcedure", async () => {
    const listed = await freshUser();
    await app.db.prepare("UPDATE user SET role = 'user,admin' WHERE id = ?").bind(listed.userId).run();
    expect(await adminCallOutcome(listed.headers)).toBe("ok");
  });

  it("a role that only starts with admin is refused by adminProcedure", async () => {
    const lookalike = await freshUser();
    await app.db.prepare("UPDATE user SET role = 'administrator' WHERE id = ?").bind(lookalike.userId).run();
    expect(await adminCallOutcome(lookalike.headers)).toBe("FORBIDDEN");
  });
});

describe("Better Auth's ban road ends the target's sessions", { timeout: 60_000 }, () => {
  it("/admin/ban-user on a plain user deletes every session row", async () => {
    const target = await freshUser();
    await app.signIn(target.email);
    expect(await sessionRows(target.userId)).toBe(2);

    const res = await callAuth("/admin/ban-user", admin.headers, { userId: target.userId });

    expect(res.status).toBe(200);
    expect(await sessionRows(target.userId)).toBe(0);
  });

  it("/admin/update-user with banned: true ends the sessions through Better Auth's own delete", async () => {
    const target = await freshUser();
    const { internalAdapter } = await app.auth.$context;
    const deleteUserSessions = vi.spyOn(internalAdapter, "deleteUserSessions");

    const res = await callAuth("/admin/update-user", admin.headers, {
      userId: target.userId,
      data: { banned: true },
    });
    const calls = [...deleteUserSessions.mock.calls];
    deleteUserSessions.mockRestore();

    expect(res.status).toBe(200);
    expect(calls).toContainEqual([target.userId]);
    expect(await sessionRows(target.userId)).toBe(0);
  });

  it("a ban written outside any endpoint still ends the sessions", async () => {
    const target = await freshUser();
    const { internalAdapter } = await app.auth.$context;

    await internalAdapter.updateUser(target.userId, { banned: true });

    expect(await sessionRows(target.userId)).toBe(0);
  });
});

describe("an admin's email change leaves the address unverified", { timeout: 60_000 }, () => {
  const markVerified = (userId: string) =>
    app.db.prepare("UPDATE user SET email_verified = 1 WHERE id = ?").bind(userId).run();

  it("through tRPC admin.updateUser, even when the admin sends verified: true", async () => {
    const target = await freshUser();
    await markVerified(target.userId);

    await (await app.callerFor(admin.headers)).admin.updateUser({
      userId: target.userId,
      data: { email: `moved${userCount}@rules.test`, verified: true },
    });

    expect(await rowOf(target.userId)).toMatchObject({
      email: `moved${userCount}@rules.test`,
      emailVerified: 0,
    });
  });

  it("through Better Auth's /admin/update-user, even when the body sends emailVerified: true", async () => {
    const target = await freshUser();
    await markVerified(target.userId);

    const res = await callAuth("/admin/update-user", admin.headers, {
      userId: target.userId,
      data: { email: `shifted${userCount}@rules.test`, emailVerified: true },
    });

    expect(res.status).toBe(200);
    expect(await rowOf(target.userId)).toMatchObject({
      email: `shifted${userCount}@rules.test`,
      emailVerified: 0,
    });
  });

  it("an update that keeps the same email keeps the address verified", async () => {
    const target = await freshUser();
    await markVerified(target.userId);

    await callAuth("/admin/update-user", admin.headers, {
      userId: target.userId,
      data: { email: target.email, name: "Same Mail" },
    });
    await (await app.callerFor(admin.headers)).admin.updateUser({
      userId: target.userId,
      data: { email: target.email },
    });

    expect(await rowOf(target.userId)).toMatchObject({ emailVerified: 1, name: "Same Mail" });
  });
});
