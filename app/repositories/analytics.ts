import { sql, count, eq, gte, lte, and } from "drizzle-orm";
import type { Context } from "@/trpc";
import { user } from "@/db/schema";

type Database = Context["db"];

export interface DateRangeInput {
  startDate: Date;
  endDate: Date;
}

/**
 * Get user growth data grouped by day
 */
export async function getUserGrowth(db: Database, input: DateRangeInput) {
  try {
    return await db
      .select({
        date: sql<string>`date(${user.createdAt} / 1000, 'unixepoch')`,
        count: count(),
      })
      .from(user)
      .where(
        and(
          gte(user.createdAt, input.startDate),
          lte(user.createdAt, input.endDate)
        )
      )
      .groupBy(sql`date(${user.createdAt} / 1000, 'unixepoch')`)
      .orderBy(sql`date(${user.createdAt} / 1000, 'unixepoch')`);
  } catch (error) {
    console.error("Failed to get user growth:", error);
    return [];
  }
}

/**
 * Get summary statistics for users
 */
export async function getUserStats(db: Database) {
  try {
    const [totalResult] = await db.select({ count: count() }).from(user);
    const [verifiedResult] = await db
      .select({ count: count() })
      .from(user)
      .where(eq(user.emailVerified, true));
    const [bannedResult] = await db
      .select({ count: count() })
      .from(user)
      .where(eq(user.banned, true));
    const [adminResult] = await db
      .select({ count: count() })
      .from(user)
      .where(eq(user.role, "admin"));

    const totalUsers = totalResult?.count ?? 0;
    const verifiedUsers = verifiedResult?.count ?? 0;
    const bannedUsers = bannedResult?.count ?? 0;
    const adminUsers = adminResult?.count ?? 0;

    const verificationRate =
      totalUsers > 0 ? Math.round((verifiedUsers / totalUsers) * 100) : 0;

    return {
      totalUsers,
      verifiedUsers,
      bannedUsers,
      adminUsers,
      verificationRate,
    };
  } catch (error) {
    console.error("Failed to get user stats:", error);
    return {
      totalUsers: 0,
      verifiedUsers: 0,
      bannedUsers: 0,
      adminUsers: 0,
      verificationRate: 0,
    };
  }
}

/**
 * Get user distribution by role
 */
export async function getRoleDistribution(db: Database) {
  try {
    const results = await db
      .select({
        name: user.role,
        value: count(),
      })
      .from(user)
      .groupBy(user.role);

    // Capitalize role names for display
    return results.map((r) => ({
      name: r.name.charAt(0).toUpperCase() + r.name.slice(1),
      value: r.value,
    }));
  } catch (error) {
    console.error("Failed to get role distribution:", error);
    return [];
  }
}

/**
 * Get user distribution by verification status
 */
export async function getVerificationDistribution(db: Database) {
  try {
    const [verifiedResult] = await db
      .select({ count: count() })
      .from(user)
      .where(eq(user.emailVerified, true));
    const [unverifiedResult] = await db
      .select({ count: count() })
      .from(user)
      .where(eq(user.emailVerified, false));

    return [
      { name: "Verified", value: verifiedResult?.count ?? 0 },
      { name: "Unverified", value: unverifiedResult?.count ?? 0 },
    ];
  } catch (error) {
    console.error("Failed to get verification distribution:", error);
    return [];
  }
}

/**
 * Get recent signups count for a given period
 */
export async function getRecentSignupsCount(
  db: Database,
  input: { days: number }
) {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - input.days);

    const [result] = await db
      .select({ count: count() })
      .from(user)
      .where(gte(user.createdAt, startDate));

    return result?.count ?? 0;
  } catch (error) {
    console.error("Failed to get recent signups:", error);
    return 0;
  }
}
