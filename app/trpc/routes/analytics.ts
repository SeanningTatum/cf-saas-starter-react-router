import { Effect, Schema } from "effect";
import { adminProcedure, createTRPCRouter } from "..";
import { runProcedure } from "@/lib/effect-trpc";
import { AnalyticsRepository } from "@/repositories/analytics";
import { generateAdminInsights } from "@/lib/ai/prompts/admin-insights/run";
import {
  DateRangeInput,
  GetRecentSignupsCountInput,
} from "@/lib/schemas/analytics";

export const analyticsRouter = createTRPCRouter({
  getUserGrowth: adminProcedure
    .input(Schema.standardSchemaV1(DateRangeInput))
    .query(({ ctx, input }) =>
      runProcedure(
        ctx.runtime,
        Effect.gen(function* () {
          const repo = yield* AnalyticsRepository;
          return yield* repo.getUserGrowth(input);
        })
      )
    ),

  getUserStats: adminProcedure.query(({ ctx }) =>
    runProcedure(
      ctx.runtime,
      Effect.gen(function* () {
        const repo = yield* AnalyticsRepository;
        return yield* repo.getUserStats;
      })
    )
  ),

  getRoleDistribution: adminProcedure.query(({ ctx }) =>
    runProcedure(
      ctx.runtime,
      Effect.gen(function* () {
        const repo = yield* AnalyticsRepository;
        return yield* repo.getRoleDistribution;
      })
    )
  ),

  getVerificationDistribution: adminProcedure.query(({ ctx }) =>
    runProcedure(
      ctx.runtime,
      Effect.gen(function* () {
        const repo = yield* AnalyticsRepository;
        return yield* repo.getVerificationDistribution;
      })
    )
  ),

  getRecentSignupsCount: adminProcedure
    .input(Schema.standardSchemaV1(GetRecentSignupsCountInput))
    .query(({ ctx, input }) =>
      runProcedure(
        ctx.runtime,
        Effect.gen(function* () {
          const repo = yield* AnalyticsRepository;
          return yield* repo.getRecentSignupsCount(input);
        })
      )
    ),

  // AI insights is a mutation, not a query: it is a paid, on-demand
  // generation (Workers AI inference), not something to fire on page load or
  // prefetch. Snapshot window is fixed (30d growth + 7d recent count) so the
  // prompt input shape matches the golden set exactly.
  getAiInsights: adminProcedure.mutation(({ ctx }) =>
    runProcedure(
      ctx.runtime,
      Effect.gen(function* () {
        const repo = yield* AnalyticsRepository;
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        const [stats, growth, recentSignups7d] = yield* Effect.all(
          [
            repo.getUserStats,
            repo.getUserGrowth({ startDate, endDate }),
            repo.getRecentSignupsCount({ days: 7 }),
          ],
          { concurrency: "unbounded" }
        );
        return yield* generateAdminInsights({
          stats,
          growth,
          recentSignups7d,
        });
      }).pipe(
        Effect.tap(() =>
          Effect.logInfo("ai_insights.generated").pipe(
            Effect.annotateLogs({ actor: ctx.auth.user.id })
          )
        )
      )
    )
  ),
});
