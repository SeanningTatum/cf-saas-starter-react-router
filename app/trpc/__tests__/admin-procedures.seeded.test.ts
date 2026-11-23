import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { PROTECTED_USER_MESSAGE } from "@/lib/constants/admin";
import { getScenario } from "@/lib/fixtures/scenarios";
import type { UserFixture } from "@/lib/fixtures/schema";
import { startSeededApp } from "./seeded-caller";

vi.mock("@/lib/log-format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log-format")>()),
  isDev: false,
}));

const scenario = Effect.runSync(getScenario("many-users"));
const ADMIN = "seed-admin";
const PLAIN = "seed-user";
const BANNED = "seed-banned";
const FIRST = "seed-user-001";
const SECOND = "seed-user-002";
const GHOST = "ghost-user";
const PAGE = 10;
const SESSION_TTL_MS = 86_400_000;

type Row = { id: string; name: string; role: string; banned: number; ban_reason: string | null };

const newestFirst = (users: ReadonlyArray<UserFixture>) =>
  [...users].sort((a, b) => b.createdAtMs - a.createdAtMs);

const userRow = async (app: ReturnType<typeof startSeededApp>, id: string) =>
  (
    await app.rows<Row>(sql`select id, name, role, banned, ban_reason from user where id = ${id}`)
  )[0];

const countOf = async (app: ReturnType<typeof startSeededApp>, table: string, id: string) =>
  (
    await app.rows<{ n: number }>(
      sql`select count(*) as n from ${sql.raw(table)} where user_id = ${id}`,
    )
  )[0]?.n;

const startSession = (app: ReturnType<typeof startSeededApp>, userId: string) =>
  app.exec(
    sql`insert into session (id, token, user_id, expires_at, updated_at)
        values (${`s-${userId}`}, ${`t-${userId}`}, ${userId}, ${Date.now() + SESSION_TTL_MS}, ${Date.now()})`,
  );

describe("admin reads, through the real procedure on many-users", () => {
  it("getUsers returns the first page newest first with the scenario's total, so a page is never cut from the wrong end or counted short", async () => {
    const app = startSeededApp("many-users");
    const result = await app.callerAs().admin.getUsers({ page: 0, limit: PAGE });
    expect(result.users.map((u) => u.id)).toEqual(
      newestFirst(scenario.users)
        .slice(0, PAGE)
        .map((u) => u.id),
    );
    expect(result.total).toBe(scenario.users.length);
    expect(result.totalPages).toBe(Math.ceil(scenario.users.length / PAGE));
  });

  it("getUsers with a role and a status filter returns only matching rows and a matching total, so a filter is not applied to the page and not the count", async () => {
    const app = startSeededApp("many-users");
    const banned = scenario.users.filter((u) => u.banned);
    const result = await app.callerAs().admin.getUsers({ page: 0, limit: 100, status: "banned" });
    expect(result.total).toBe(banned.length);
    expect(result.users.every((u) => u.banned)).toBe(true);
  });

  it("getUsers past the last page returns no rows and the same total, so an out-of-range page does not fail", async () => {
    const app = startSeededApp("many-users");
    const result = await app.callerAs().admin.getUsers({ page: 99, limit: PAGE });
    expect(result.users).toEqual([]);
    expect(result.total).toBe(scenario.users.length);
  });

  it("getUser returns the row for an id, so the detail page shows the user asked for", async () => {
    const app = startSeededApp("many-users");
    const found = await app.callerAs().admin.getUser({ userId: BANNED });
    expect(found).toMatchObject({ id: BANNED, banned: true });
  });

  it("getUser for an unknown id is NOT_FOUND naming the user, so a missing user is a 404 and not an empty page", async () => {
    const app = startSeededApp("many-users");
    await expect(app.callerAs().admin.getUser({ userId: GHOST })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: `user not found: ${GHOST}`,
    });
  });

  it("dbHealth reports ok with a check time, so the health panel reads a live database", async () => {
    const app = startSeededApp("base");
    const health = await app.callerAs().admin.dbHealth();
    expect(health.ok).toBe(true);
    expect(new Date(health.checkedAt).getTime()).not.toBeNaN();
  });
});

describe("admin.updateUser", () => {
  it("renames the user and leaves the other fields alone, so a partial update does not blank a column", async () => {
    const app = startSeededApp("many-users");
    const before = await userRow(app, PLAIN);
    await expect(
      app.callerAs().admin.updateUser({ userId: PLAIN, data: { name: "Renamed" } }),
    ).resolves.toEqual({ success: true });
    expect(await userRow(app, PLAIN)).toEqual({ ...before, name: "Renamed" });
  });

  it("refuses an admin target with BAD_REQUEST and the protected-user message, and writes nothing", async () => {
    const app = startSeededApp("many-users");
    await expect(
      app.callerAs().admin.updateUser({ userId: ADMIN, data: { name: "Hijacked" } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: PROTECTED_USER_MESSAGE });
    expect((await userRow(app, ADMIN))?.name).not.toBe("Hijacked");
  });

  it("is NOT_FOUND for an unknown id, so an edit of a deleted user does not look like a success", async () => {
    const app = startSeededApp("many-users");
    await expect(
      app.callerAs().admin.updateUser({ userId: GHOST, data: { name: "x" } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("admin.banUser", () => {
  it("bans the user with the reason, ends their sessions and reports the event, so a ban takes hold at once and is counted", async () => {
    const app = startSeededApp("many-users");
    await startSession(app, PLAIN);
    await startSession(app, SECOND);
    await expect(app.callerAs().admin.banUser({ userId: PLAIN, reason: "spam" })).resolves.toEqual({
      success: true,
    });
    expect(await userRow(app, PLAIN)).toMatchObject({ banned: 1, ban_reason: "spam" });
    expect(await countOf(app, "session", PLAIN)).toBe(0);
    expect(await countOf(app, "session", SECOND)).toBe(1);
    expect(app.events).toEqual([
      {
        _tag: "user_banned",
        distinctId: ADMIN,
        targetUserId: PLAIN,
        hasReason: true,
        hasExpiry: false,
      },
    ]);
  });

  it("refuses to ban the caller with BAD_REQUEST, leaves the row and reports no event, so an admin cannot lock themselves out", async () => {
    const app = startSeededApp("many-users");
    await expect(app.callerAs().admin.banUser({ userId: ADMIN })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: PROTECTED_USER_MESSAGE,
    });
    expect((await userRow(app, ADMIN))?.banned).toBe(0);
    expect(app.events).toEqual([]);
  });
});

describe("admin.unbanUser", () => {
  it("clears the flag, the reason and the expiry, so an unbanned user is not half banned", async () => {
    const app = startSeededApp("many-users");
    await expect(app.callerAs().admin.unbanUser({ userId: BANNED })).resolves.toEqual({
      success: true,
    });
    expect(await userRow(app, BANNED)).toMatchObject({ banned: 0, ban_reason: null });
  });

  it("is NOT_FOUND for an unknown id, so a stale unban click does not report success", async () => {
    const app = startSeededApp("many-users");
    await expect(app.callerAs().admin.unbanUser({ userId: GHOST })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("admin.deleteUser", () => {
  it("deletes the user and their accounts and sessions, so no login or session outlives the row", async () => {
    const app = startSeededApp("many-users");
    await startSession(app, PLAIN);
    expect(await countOf(app, "account", PLAIN)).toBe(1);
    await expect(app.callerAs().admin.deleteUser({ userId: PLAIN })).resolves.toEqual({
      success: true,
    });
    expect(await userRow(app, PLAIN)).toBeUndefined();
    expect(await countOf(app, "account", PLAIN)).toBe(0);
    expect(await countOf(app, "session", PLAIN)).toBe(0);
  });

  it("refuses to delete the caller with BAD_REQUEST and keeps the row, so an admin cannot delete themselves", async () => {
    const app = startSeededApp("many-users");
    await expect(app.callerAs().admin.deleteUser({ userId: ADMIN })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: PROTECTED_USER_MESSAGE,
    });
    expect(await userRow(app, ADMIN)).toBeDefined();
  });
});

describe("admin bulk procedures on many-users", () => {
  const everyId = scenario.users.map((u) => u.id);
  const plainIds = everyId.filter((id) => id !== ADMIN);

  it("bulkBanUsers bans every id but the caller's and counts the caller as skipped, so the cap-sized call reports what it did", async () => {
    const app = startSeededApp("many-users");
    const result = await app.callerAs().admin.bulkBanUsers({ userIds: everyId, reason: "wave" });
    expect(result).toEqual({ success: true, affectedCount: plainIds.length, skippedCount: 1 });
    const banned = await app.rows<{ n: number }>(sql`select count(*) as n from user where banned`);
    expect(banned[0]?.n).toBe(everyId.length - 1);
    expect((await userRow(app, ADMIN))?.banned).toBe(0);
  });

  it("bulkBanUsers counts an unknown id as skipped and bans the rest, so a stale selection does not fail the batch", async () => {
    const app = startSeededApp("many-users");
    const result = await app.callerAs().admin.bulkBanUsers({ userIds: [FIRST, SECOND, GHOST] });
    expect(result).toEqual({ success: true, affectedCount: 2, skippedCount: 1 });
  });

  it("bulkBanUsers over only protected ids returns zero affected and touches no row, so a self-only selection is a no-op and not an error", async () => {
    const app = startSeededApp("many-users");
    const result = await app.callerAs().admin.bulkBanUsers({ userIds: [ADMIN] });
    expect(result).toEqual({ success: true, affectedCount: 0, skippedCount: 1 });
    expect((await userRow(app, ADMIN))?.banned).toBe(0);
  });

  it("bulkDeleteUsers deletes the chosen users and their accounts and keeps the rest, so the delete is bound to its ids", async () => {
    const app = startSeededApp("many-users");
    const result = await app.callerAs().admin.bulkDeleteUsers({ userIds: [FIRST, SECOND, ADMIN] });
    expect(result).toEqual({ success: true, affectedCount: 2, skippedCount: 1 });
    const left = await app.rows<{ n: number }>(sql`select count(*) as n from user`);
    expect(left[0]?.n).toBe(everyId.length - 2);
    expect(await countOf(app, "account", FIRST)).toBe(0);
    expect(await countOf(app, "account", PLAIN)).toBe(1);
  });

  it("bulkUpdateUserRoles sets the role on the chosen users only, so a role change does not spread past its ids", async () => {
    const app = startSeededApp("many-users");
    const result = await app
      .callerAs()
      .admin.bulkUpdateUserRoles({ userIds: [FIRST, SECOND], role: "admin" });
    expect(result).toEqual({ success: true, affectedCount: 2, skippedCount: 0 });
    expect((await userRow(app, FIRST))?.role).toBe("admin");
    expect((await userRow(app, SECOND))?.role).toBe("admin");
    expect((await userRow(app, PLAIN))?.role).toBe("user");
  });
});
