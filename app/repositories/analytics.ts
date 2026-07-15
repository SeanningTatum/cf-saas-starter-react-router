import { Effect } from "effect";
import { sql, count, eq, gte, lte, and } from "drizzle-orm";
import { user } from "@/db/schema";
import { Database } from "@/services/database";
import { tryQuery } from "@/lib/effect-utils";
import type {
  DateRangeInput,
  GetRecentSignupsCountInput,
} from "@/lib/schemas/analytics";

export class AnalyticsRepository extends Effect.Service<AnalyticsRepository>()(
  "app/AnalyticsRepository",
  {
    effect: Effect.gen(function* () {
      const { db } = yield* Database;

      const getUserGrowth = (input: DateRangeInput) =>
        tryQuery("user_growth", () =>
          db
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
            .orderBy(sql`date(${user.createdAt} / 1000, 'unixepoch')`)
        );

      const getUserStats = Effect.gen(function* () {
        const [totalResult, verifiedResult, bannedResult, adminResult] =
          yield* Effect.all(
            [
              tryQuery("user_stats", () => db.select({ count: count() }).from(user)),
              tryQuery("user_stats", () =>
                db.select({ count: count() }).from(user).where(eq(user.emailVerified, true))
              ),
              tryQuery("user_stats", () =>
                db.select({ count: count() }).from(user).where(eq(user.banned, true))
              ),
              tryQuery("user_stats", () =>
                db.select({ count: count() }).from(user).where(eq(user.role, "admin"))
              ),
            ],
            { concurrency: "unbounded" }
          );

        const totalUsers = totalResult[0]?.count ?? 0;
        const verifiedUsers = verifiedResult[0]?.count ?? 0;
        const bannedUsers = bannedResult[0]?.count ?? 0;
        const adminUsers = adminResult[0]?.count ?? 0;
        const verificationRate =
          totalUsers > 0 ? Math.round((verifiedUsers / totalUsers) * 100) : 0;

        return {
          totalUsers,
          verifiedUsers,
          bannedUsers,
          adminUsers,
          verificationRate,
        };
      });

      const getRoleDistribution = Effect.gen(function* () {
        const results = yield* tryQuery("role_distribution", () =>
          db
            .select({
              name: user.role,
              value: count(),
            })
            .from(user)
            .groupBy(user.role)
        );
        return results.map((r) => ({
          name: r.name.charAt(0).toUpperCase() + r.name.slice(1),
          value: r.value,
        }));
      });

      const getVerificationDistribution = Effect.gen(function* () {
        const [verifiedResult, unverifiedResult] = yield* Effect.all(
          [
            tryQuery("verification_distribution", () =>
              db.select({ count: count() }).from(user).where(eq(user.emailVerified, true))
            ),
            tryQuery("verification_distribution", () =>
              db.select({ count: count() }).from(user).where(eq(user.emailVerified, false))
            ),
          ],
          { concurrency: "unbounded" }
        );
        return [
          { name: "Verified", value: verifiedResult[0]?.count ?? 0 },
          { name: "Unverified", value: unverifiedResult[0]?.count ?? 0 },
        ];
      });

      const getRecentSignupsCount = (input: GetRecentSignupsCountInput) =>
        Effect.gen(function* () {
          const startDate = new Date();
          startDate.setDate(startDate.getDate() - input.days);
          const result = yield* tryQuery("recent_signups", () =>
            db.select({ count: count() }).from(user).where(gte(user.createdAt, startDate))
          );
          return result[0]?.count ?? 0;
        });

      return {
        getUserGrowth,
        getUserStats,
        getRoleDistribution,
        getVerificationDistribution,
        getRecentSignupsCount,
      } as const;
    }),
  }
) {}
