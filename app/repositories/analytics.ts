import { Effect } from "effect";
import { sql, count, eq, gte, lte, and } from "drizzle-orm";
import { user } from "@/db/schema";
import { Database } from "@/services/database";
import { QueryError } from "@/models/errors/repository";
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
        Effect.tryPromise({
          try: () =>
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
              .orderBy(sql`date(${user.createdAt} / 1000, 'unixepoch')`),
          catch: (cause) =>
            new QueryError({ entity: "user_growth", cause }),
        });

      const getUserStats = Effect.gen(function* () {
        const [totalResult, verifiedResult, bannedResult, adminResult] =
          yield* Effect.all(
            [
              Effect.tryPromise({
                try: () => db.select({ count: count() }).from(user),
                catch: (cause) =>
                  new QueryError({ entity: "user_stats", cause }),
              }),
              Effect.tryPromise({
                try: () =>
                  db
                    .select({ count: count() })
                    .from(user)
                    .where(eq(user.emailVerified, true)),
                catch: (cause) =>
                  new QueryError({ entity: "user_stats", cause }),
              }),
              Effect.tryPromise({
                try: () =>
                  db
                    .select({ count: count() })
                    .from(user)
                    .where(eq(user.banned, true)),
                catch: (cause) =>
                  new QueryError({ entity: "user_stats", cause }),
              }),
              Effect.tryPromise({
                try: () =>
                  db
                    .select({ count: count() })
                    .from(user)
                    .where(eq(user.role, "admin")),
                catch: (cause) =>
                  new QueryError({ entity: "user_stats", cause }),
              }),
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
        const results = yield* Effect.tryPromise({
          try: () =>
            db
              .select({
                name: user.role,
                value: count(),
              })
              .from(user)
              .groupBy(user.role),
          catch: (cause) =>
            new QueryError({ entity: "role_distribution", cause }),
        });
        return results.map((r) => ({
          name: r.name.charAt(0).toUpperCase() + r.name.slice(1),
          value: r.value,
        }));
      });

      const getVerificationDistribution = Effect.gen(function* () {
        const [verifiedResult, unverifiedResult] = yield* Effect.all(
          [
            Effect.tryPromise({
              try: () =>
                db
                  .select({ count: count() })
                  .from(user)
                  .where(eq(user.emailVerified, true)),
              catch: (cause) =>
                new QueryError({
                  entity: "verification_distribution",
                  cause,
                }),
            }),
            Effect.tryPromise({
              try: () =>
                db
                  .select({ count: count() })
                  .from(user)
                  .where(eq(user.emailVerified, false)),
              catch: (cause) =>
                new QueryError({
                  entity: "verification_distribution",
                  cause,
                }),
            }),
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
          const result = yield* Effect.tryPromise({
            try: () =>
              db
                .select({ count: count() })
                .from(user)
                .where(gte(user.createdAt, startDate)),
            catch: (cause) =>
              new QueryError({ entity: "recent_signups", cause }),
          });
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
