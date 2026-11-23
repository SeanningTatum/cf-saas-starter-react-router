import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { ADMIN_SELF_DELETE_MESSAGE } from "@/lib/constants/admin";
import { uploadKeyFor } from "@/lib/constants/upload";
import { startSeededApp, type SeededApp } from "@/trpc/__tests__/seeded-caller";
import { appRouter } from "@/trpc/router";

vi.mock("@/lib/log-format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log-format")>()),
  isDev: false,
}));

const PLAIN = "seed-user";
const BANNED = "seed-banned";
const ADMIN = "seed-admin";
const PLAIN_UPLOAD = `${PLAIN}-upload`;

const count = async (
  app: SeededApp,
  table: "user" | "session" | "upload",
  column: string,
  id: string,
) =>
  (
    await app.rows<{ n: number }>(
      sql.raw(`select count(*) as n from ${table} where ${column} = '${id}'`),
    )
  )[0]?.n;

const withSession = async (app: SeededApp, userId: string) => {
  await app.exec(
    sql`insert into session (id, expires_at, token, updated_at, user_id) values (${`s-${userId}`}, 9999999999999, ${`t-${userId}`}, 1, ${userId})`,
  );
  app.bucket.seed(uploadKeyFor(userId, `${userId}-upload`));
};

describe("account.exportData", () => {
  it("returns the caller's profile, sessions, sign-in methods and uploads, and no secret", async () => {
    const app = startSeededApp(appRouter, "base");
    await withSession(app, PLAIN);

    const result = await app.callerAs({ id: PLAIN, role: "user" }).account.exportData();

    expect(result.profile).toMatchObject({
      id: PLAIN,
      email: "user@preview.local",
    });
    expect(result.sessions.map((s) => s.id)).toEqual([`s-${PLAIN}`]);
    expect(result.uploads.map((u) => u.id)).toEqual([PLAIN_UPLOAD]);
    expect(result.accounts.map((a) => a.providerId)).toEqual(["credential"]);
    expect(JSON.stringify(result)).not.toMatch(/password|token|scrypt/i);
  });

  it("takes no id: it exports the caller's own data and never another user's", async () => {
    const app = startSeededApp(appRouter, "base");

    const result = await app.callerAs({ id: BANNED, role: "user" }).account.exportData();

    expect(result.profile.id).toBe(BANNED);
    expect(result.uploads.every((u) => u.id.startsWith(BANNED))).toBe(true);
  });

  it("refuses a signed-out caller", async () => {
    const app = startSeededApp(appRouter, "base");
    await expect(app.callerAs(null).account.exportData()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("account.deleteAccount", () => {
  it("removes the caller's user, sessions, upload rows and objects, and no one else's", async () => {
    const app = startSeededApp(appRouter, "base");
    await withSession(app, PLAIN);
    await withSession(app, BANNED);

    await app.callerAs({ id: PLAIN, role: "user" }).account.deleteAccount();

    expect(await count(app, "user", "id", PLAIN)).toBe(0);
    expect(await count(app, "session", "user_id", PLAIN)).toBe(0);
    expect(await count(app, "upload", "user_id", PLAIN)).toBe(0);
    expect(app.bucket.keys()).toEqual([uploadKeyFor(BANNED, `${BANNED}-upload`)]);
    expect(await count(app, "user", "id", BANNED)).toBe(1);
    expect(await count(app, "session", "user_id", BANNED)).toBe(1);
    expect(await count(app, "upload", "user_id", BANNED)).toBe(1);
  });

  it("refuses an admin, so the last admin cannot lock the site out by deleting itself", async () => {
    const app = startSeededApp(appRouter, "base");

    await expect(
      app.callerAs({ id: ADMIN, role: "admin" }).account.deleteAccount(),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: ADMIN_SELF_DELETE_MESSAGE,
    });
    expect(await count(app, "user", "id", ADMIN)).toBe(1);
  });

  it("refuses a signed-out caller", async () => {
    const app = startSeededApp(appRouter, "base");
    await expect(app.callerAs(null).account.deleteAccount()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("admin deletes remove a user's objects too", () => {
  it("deleteUser purges the objects and rows before the user", async () => {
    const app = startSeededApp(appRouter, "base");
    await withSession(app, PLAIN);

    await app.callerAs().admin.deleteUser({ userId: PLAIN });

    expect(app.bucket.keys()).toEqual([]);
    expect(await count(app, "upload", "user_id", PLAIN)).toBe(0);
    expect(await count(app, "user", "id", PLAIN)).toBe(0);
  });

  it("deleteUser leaves a protected admin's objects alone when it refuses", async () => {
    const app = startSeededApp(appRouter, "base");
    await withSession(app, ADMIN);

    await expect(app.callerAs().admin.deleteUser({ userId: ADMIN })).rejects.toBeDefined();

    expect(app.bucket.keys()).toEqual([uploadKeyFor(ADMIN, `${ADMIN}-upload`)]);
    expect(await count(app, "upload", "user_id", ADMIN)).toBe(1);
  });

  it("bulkDeleteUsers purges the objects of the users it deletes and only those", async () => {
    const app = startSeededApp(appRouter, "base");
    await withSession(app, PLAIN);
    await withSession(app, BANNED);

    await app.callerAs().admin.bulkDeleteUsers({ userIds: [PLAIN] });

    expect(app.bucket.keys()).toEqual([uploadKeyFor(BANNED, `${BANNED}-upload`)]);
    expect(await count(app, "upload", "user_id", PLAIN)).toBe(0);
    expect(await count(app, "upload", "user_id", BANNED)).toBe(1);
  });
});
