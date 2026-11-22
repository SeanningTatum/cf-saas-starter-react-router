import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startRealApp, type Account, type AppCaller, type RealApp } from "./real-d1";

vi.mock("@/lib/log-format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log-format")>()),
  isDev: false,
}));

type Row = { id: string; role: string; banned: number };

describe("bulk admin procedures skip the caller and every admin", { timeout: 60_000 }, () => {
  let app: RealApp;
  let caller: Account;
  let otherAdmin: Account;

  beforeAll(async () => {
    app = await startRealApp();
    caller = await app.signUpAdmin("caller@bulk.test");
    otherAdmin = await app.signUpAdmin("other-admin@bulk.test");
  }, 60_000);

  afterAll(async () => {
    await app?.dispose();
  });

  const asCaller = (): Promise<AppCaller> => app.callerFor(caller.headers);

  const seedPlainUser = async (id: string): Promise<string> => {
    await app.db
      .prepare("INSERT INTO user (id, name, email) VALUES (?, ?, ?)")
      .bind(id, id, `${id}@bulk.test`)
      .run();
    return id;
  };

  const row = async (id: string) =>
    app.db.prepare("SELECT id, role, banned FROM user WHERE id = ?").bind(id).first<Row>();

  const adminsUntouched = async () => {
    expect(await row(caller.userId)).toMatchObject({ role: "admin", banned: 0 });
    expect(await row(otherAdmin.userId)).toMatchObject({ role: "admin", banned: 0 });
  };

  it("admin.bulkBanUsers bans the plain user and counts the caller and the other admin as skipped", async () => {
    const plain = await seedPlainUser("bulk-ban-plain");
    const result = await (await asCaller()).admin.bulkBanUsers({
      userIds: [caller.userId, otherAdmin.userId, plain],
      reason: "spam",
    });
    expect(result).toEqual({ success: true, affectedCount: 1, skippedCount: 2 });
    expect(await row(plain)).toMatchObject({ banned: 1 });
    await adminsUntouched();
  });

  it("admin.bulkUpdateUserRoles cannot demote the caller or another admin", async () => {
    const plain = await seedPlainUser("bulk-role-plain");
    const result = await (await asCaller()).admin.bulkUpdateUserRoles({
      userIds: [caller.userId, otherAdmin.userId, plain],
      role: "user",
    });
    expect(result).toEqual({ success: true, affectedCount: 1, skippedCount: 2 });
    expect(await row(plain)).toMatchObject({ role: "user" });
    await adminsUntouched();
  });

  it("admin.bulkDeleteUsers cannot delete the caller or another admin", async () => {
    const plain = await seedPlainUser("bulk-delete-plain");
    const result = await (await asCaller()).admin.bulkDeleteUsers({
      userIds: [caller.userId, otherAdmin.userId, plain],
    });
    expect(result).toEqual({ success: true, affectedCount: 1, skippedCount: 2 });
    expect(await row(plain)).toBeNull();
    await adminsUntouched();
  });
});
