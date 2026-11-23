import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { getScenario } from "@/lib/fixtures/scenarios";
import { startSeededApp } from "./seeded-caller";

vi.mock("@/lib/log-format", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log-format")>()),
  isDev: false,
}));

const scenario = Effect.runSync(getScenario("many-users"));
const DAY_MS = 86_400_000;
const WIDE_START = new Date(0);
const WIDE_END = new Date(8_640_000_000_000_000);

const countWhere = (keep: (u: (typeof scenario.users)[number]) => boolean) =>
  scenario.users.filter(keep).length;

const signUpAt = (app: ReturnType<typeof startSeededApp>, id: string, atMs: number) =>
  app.exec(
    sql`insert into user (id, name, email, created_at, updated_at)
        values (${id}, ${id}, ${`${id}@analytics.test`}, ${atMs}, ${atMs})`,
  );

describe("analytics procedures, through the real procedure on many-users", () => {
  it("getUserStats counts total, verified, banned and admin users from the rows and rounds the rate, so a card never shows a stale or mislabelled count", async () => {
    const app = startSeededApp("many-users");
    const stats = await app.callerAs().analytics.getUserStats();
    const verified = countWhere((u) => u.emailVerified);
    expect(stats).toEqual({
      totalUsers: scenario.users.length,
      verifiedUsers: verified,
      bannedUsers: countWhere((u) => u.banned),
      adminUsers: countWhere((u) => u.role === "admin"),
      verificationRate: Math.round((verified / scenario.users.length) * 100),
    });
  });

  it("getUserStats on an empty database is all zeros with a rate of 0, so an empty table does not divide by zero", async () => {
    const app = startSeededApp("empty");
    expect(await app.callerAs().analytics.getUserStats()).toEqual({
      totalUsers: 0,
      verifiedUsers: 0,
      bannedUsers: 0,
      adminUsers: 0,
      verificationRate: 0,
    });
  });

  it("getRoleDistribution returns capitalised role names with their counts, so the chart labels read Admin and User", async () => {
    const app = startSeededApp("many-users");
    const distribution = await app.callerAs().analytics.getRoleDistribution();
    expect([...distribution].sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: "Admin", value: countWhere((u) => u.role === "admin") },
      { name: "User", value: countWhere((u) => u.role === "user") },
    ]);
  });

  it("getVerificationDistribution splits users into Verified and Unverified that add up to the total, so no user is dropped from the pie", async () => {
    const app = startSeededApp("many-users");
    const distribution = await app.callerAs().analytics.getVerificationDistribution();
    expect(distribution).toEqual([
      { name: "Verified", value: countWhere((u) => u.emailVerified) },
      { name: "Unverified", value: countWhere((u) => !u.emailVerified) },
    ]);
  });

  it("getUserGrowth groups signups by calendar day in date order, so a day's count is not split or merged with its neighbour", async () => {
    const app = startSeededApp("many-users");
    const growth = await app
      .callerAs()
      .analytics.getUserGrowth({ startDate: WIDE_START, endDate: WIDE_END });
    const perDay = new Map<string, number>();
    for (const u of scenario.users) {
      const day = new Date(u.createdAtMs).toISOString().slice(0, 10);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
    expect(growth).toEqual(
      [...perDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, count })),
    );
  });

  it("getUserGrowth with a range that holds no signup returns an empty list, so a quiet period is an empty chart and not an error", async () => {
    const app = startSeededApp("many-users");
    const growth = await app
      .callerAs()
      .analytics.getUserGrowth({ startDate: new Date(0), endDate: new Date(DAY_MS) });
    expect(growth).toEqual([]);
  });

  it("getRecentSignupsCount counts only signups inside the window, so a user from before the window is not counted", async () => {
    const app = startSeededApp("empty");
    const now = Date.now();
    await signUpAt(app, "recent-1", now - DAY_MS);
    await signUpAt(app, "recent-2", now - 2 * DAY_MS);
    await signUpAt(app, "old-1", now - 30 * DAY_MS);
    const caller = app.callerAs();
    expect(await caller.analytics.getRecentSignupsCount({ days: 7 })).toBe(2);
    expect(await caller.analytics.getRecentSignupsCount({ days: 60 })).toBe(3);
  });

  it("getRecentSignupsCount defaults to a 7-day window, so the dashboard card keeps its documented range", async () => {
    const app = startSeededApp("empty");
    const now = Date.now();
    await signUpAt(app, "inside", now - 6 * DAY_MS);
    await signUpAt(app, "outside", now - 9 * DAY_MS);
    expect(await app.callerAs().analytics.getRecentSignupsCount({})).toBe(1);
  });
});
