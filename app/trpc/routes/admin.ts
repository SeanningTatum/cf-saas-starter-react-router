import { z } from "zod/v4";
import { adminProcedure, createTRPCRouter } from "..";
import { TRPCError } from "@trpc/server";
import * as userRepository from "@/repositories/user";

export const adminRouter = createTRPCRouter({
  getUsers: adminProcedure
    .input(
      z.object({
        page: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(10),
        search: z.string().optional(),
        role: z.enum(["user", "admin"]).optional(),
        status: z.enum(["verified", "unverified", "banned"]).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      return await userRepository.getUsers(ctx.db, input);
    }),

  getUser: adminProcedure
    .input(
      z.object({
        userId: z.string(),
      })
    )
    .query(async ({ ctx, input }) => {
      return await userRepository.getUser(ctx.db, input);
    }),
  updateUser: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        data: z.object({
          name: z.string().optional(),
          email: z.string().email().optional(),
          role: z.enum(["user", "admin"]).optional(),
          banned: z.boolean().optional(),
          banReason: z.string().optional(),
          banExpires: z.date().optional(),
          verified: z.boolean().optional(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await userRepository.updateUser(ctx.db, {
        userId: input.userId,
        currentUserId: ctx.auth.user.id,
        data: input.data,
      });
    }),

  banUser: adminProcedure
    .input(
      z.object({
        userId: z.string(),
        reason: z.string().optional(),
        expiresAt: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await userRepository.banUser(ctx.db, {
        userId: input.userId,
        currentUserId: ctx.auth.user.id,
        reason: input.reason,
        expiresAt: input.expiresAt,
      });
    }),

  unbanUser: adminProcedure
    .input(
      z.object({
        userId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await userRepository.unbanUser(ctx.db, input);
    }),
  deleteUser: adminProcedure
    .input(
      z.object({
        userId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await userRepository.deleteUser(ctx.db, {
        userId: input.userId,
        currentUserId: ctx.auth.user.id,
      });
    }),
  bulkBanUsers: adminProcedure
    .input(
      z.object({
        userIds: z.array(z.string()).min(1),
        reason: z.string().optional(),
        expiresAt: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Filter out protected users (admins and self)
      const { validUserIds, skippedCount } =
        await userRepository.filterProtectedUsers(
          ctx.db,
          input.userIds,
          ctx.auth.user.id
        );

      if (validUserIds.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No valid users to ban (all selected users are protected)",
        });
      }

      const affectedCount = await userRepository.bulkBanUsers(ctx.db, {
        userIds: validUserIds,
        reason: input.reason,
        expiresAt: input.expiresAt,
      });

      return {
        success: true,
        affectedCount,
        skippedCount,
      };
    }),

  bulkDeleteUsers: adminProcedure
    .input(
      z.object({
        userIds: z.array(z.string()).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Filter out protected users (admins and self)
      const { validUserIds, skippedCount } =
        await userRepository.filterProtectedUsers(
          ctx.db,
          input.userIds,
          ctx.auth.user.id
        );

      if (validUserIds.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "No valid users to delete (all selected users are protected)",
        });
      }

      const affectedCount = await userRepository.bulkDeleteUsers(ctx.db, {
        userIds: validUserIds,
      });

      return {
        success: true,
        affectedCount,
        skippedCount,
      };
    }),
  bulkUpdateUserRoles: adminProcedure
    .input(
      z.object({
        userIds: z.array(z.string()).min(1),
        role: z.enum(["user", "admin"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Filter out protected users (admins and self)
      const { validUserIds, skippedCount } =
        await userRepository.filterProtectedUsers(
          ctx.db,
          input.userIds,
          ctx.auth.user.id
        );

      if (validUserIds.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "No valid users to update (all selected users are protected)",
        });
      }

      const affectedCount = await userRepository.bulkUpdateUserRoles(ctx.db, {
        userIds: validUserIds,
        role: input.role,
      });

      return {
        success: true,
        affectedCount,
        skippedCount,
      };
    }),
});
