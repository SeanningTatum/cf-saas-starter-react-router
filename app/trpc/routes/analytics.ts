import { Effect, Schema } from "effect";
import { adminProcedure, createTRPCRouter } from "..";
import { runProcedure } from "@/lib/effect-trpc";
import { AnalyticsRepository } from "@/repositories/analytics";
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
        }),
        { span: "trpc.analytics.getUserGrowth" }
      )
    ),

  getUserStats: adminProcedure.query(({ ctx }) =>
    runProcedure(
      ctx.runtime,
      Effect.gen(function* () {
        const repo = yield* AnalyticsRepository;
        return yield* repo.getUserStats;
      }),
      { span: "trpc.analytics.getUserStats" }
    )
  ),

  getRoleDistribution: adminProcedure.query(({ ctx }) =>
    runProcedure(
      ctx.runtime,
      Effect.gen(function* () {
        const repo = yield* AnalyticsRepository;
        return yield* repo.getRoleDistribution;
      }),
      { span: "trpc.analytics.getRoleDistribution" }
    )
  ),

  getVerificationDistribution: adminProcedure.query(({ ctx }) =>
    runProcedure(
      ctx.runtime,
      Effect.gen(function* () {
        const repo = yield* AnalyticsRepository;
        return yield* repo.getVerificationDistribution;
      }),
      { span: "trpc.analytics.getVerificationDistribution" }
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
        }),
        { span: "trpc.analytics.getRecentSignupsCount" }
      )
    ),
});
