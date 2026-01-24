import { z } from "zod/v4";
import { adminProcedure, createTRPCRouter } from "..";
import * as analyticsRepository from "@/repositories/analytics";

export const analyticsRouter = createTRPCRouter({
  getUserGrowth: adminProcedure
    .input(
      z.object({
        startDate: z.date(),
        endDate: z.date(),
      })
    )
    .query(({ ctx, input }) =>
      analyticsRepository.getUserGrowth(ctx.db, input)
    ),

  getUserStats: adminProcedure.query(({ ctx }) =>
    analyticsRepository.getUserStats(ctx.db)
  ),

  getRoleDistribution: adminProcedure.query(({ ctx }) =>
    analyticsRepository.getRoleDistribution(ctx.db)
  ),

  getVerificationDistribution: adminProcedure.query(({ ctx }) =>
    analyticsRepository.getVerificationDistribution(ctx.db)
  ),

  getRecentSignupsCount: adminProcedure
    .input(
      z.object({
        days: z.number().int().min(1).max(365).default(7),
      })
    )
    .query(({ ctx, input }) =>
      analyticsRepository.getRecentSignupsCount(ctx.db, input)
    ),
});
