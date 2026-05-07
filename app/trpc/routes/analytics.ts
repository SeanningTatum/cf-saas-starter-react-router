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
});
