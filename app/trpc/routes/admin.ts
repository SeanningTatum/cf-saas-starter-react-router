import { Effect, Schema } from "effect";
import { adminProcedure, createTRPCRouter } from "..";
import { runProcedure } from "@/lib/effect-trpc";
import { UserRepository } from "@/repositories/user";
import { ValidationError } from "@/models/errors/repository";
import {
  GetUsersInput,
  GetUserInput,
  UpdateUserInput,
  BanUserInput,
  UnbanUserInput,
  DeleteUserInput,
  BulkBanUsersInput,
  BulkDeleteUsersInput,
  BulkUpdateUserRolesInput,
} from "@/lib/schemas/user";

export const adminRouter = createTRPCRouter({
  getUsers: adminProcedure
    .input(Schema.standardSchemaV1(GetUsersInput))
    .query(({ ctx, input }) =>
      runProcedure(
        ctx.runtime,
        Effect.gen(function* () {
          const repo = yield* UserRepository;
          return yield* repo.getUsers(input);
        })
      )
    ),

  getUser: adminProcedure
    .input(Schema.standardSchemaV1(GetUserInput))
    .query(({ ctx, input }) =>
      runProcedure(
        ctx.runtime,
        Effect.gen(function* () {
          const repo = yield* UserRepository;
          return yield* repo.getUser(input);
        })
      )
    ),

  updateUser: adminProcedure
    .input(Schema.standardSchemaV1(UpdateUserInput))
    .mutation(({ ctx, input }) =>
      runProcedure(
        ctx.runtime,
        Effect.gen(function* () {
          const repo = yield* UserRepository;
          return yield* repo.updateUser({
            ...input,
            currentUserId: ctx.auth.user.id,
          });
        })
      )
    ),

  banUser: adminProcedure
    .input(Schema.standardSchemaV1(BanUserInput))
    .mutation(({ ctx, input }) =>
      runProcedure(
        ctx.runtime,
        Effect.gen(function* () {
          const repo = yield* UserRepository;
          return yield* repo.banUser({
            ...input,
            currentUserId: ctx.auth.user.id,
          });
        })
      )
    ),

  unbanUser: adminProcedure
    .input(Schema.standardSchemaV1(UnbanUserInput))
    .mutation(({ ctx, input }) =>
      runProcedure(
        ctx.runtime,
        Effect.gen(function* () {
          const repo = yield* UserRepository;
          return yield* repo.unbanUser(input);
        })
      )
    ),

  deleteUser: adminProcedure
    .input(Schema.standardSchemaV1(DeleteUserInput))
    .mutation(({ ctx, input }) =>
      runProcedure(
        ctx.runtime,
        Effect.gen(function* () {
          const repo = yield* UserRepository;
          return yield* repo.deleteUser({
            ...input,
            currentUserId: ctx.auth.user.id,
          });
        })
      )
    ),

  bulkBanUsers: adminProcedure
    .input(Schema.standardSchemaV1(BulkBanUsersInput))
    .mutation(({ ctx, input }) =>
      runProcedure(
        ctx.runtime,
        Effect.gen(function* () {
          const repo = yield* UserRepository;
          const { validUserIds, skippedCount } = yield* repo.filterProtectedUsers(
            { userIds: input.userIds, currentUserId: ctx.auth.user.id }
          );
          if (validUserIds.length === 0) {
            return yield* Effect.fail(
              new ValidationError({
                entity: "user",
                field: "userIds",
                message: "No valid users to ban (all selected users are protected)",
              })
            );
          }
          const affectedCount = yield* repo.bulkBanUsers({
            userIds: validUserIds,
            reason: input.reason,
            expiresAt: input.expiresAt,
          });
          return { success: true, affectedCount, skippedCount } as const;
        })
      )
    ),

  bulkDeleteUsers: adminProcedure
    .input(Schema.standardSchemaV1(BulkDeleteUsersInput))
    .mutation(({ ctx, input }) =>
      runProcedure(
        ctx.runtime,
        Effect.gen(function* () {
          const repo = yield* UserRepository;
          const { validUserIds, skippedCount } = yield* repo.filterProtectedUsers(
            { userIds: input.userIds, currentUserId: ctx.auth.user.id }
          );
          if (validUserIds.length === 0) {
            return yield* Effect.fail(
              new ValidationError({
                entity: "user",
                field: "userIds",
                message:
                  "No valid users to delete (all selected users are protected)",
              })
            );
          }
          const affectedCount = yield* repo.bulkDeleteUsers({
            userIds: validUserIds,
          });
          return { success: true, affectedCount, skippedCount } as const;
        })
      )
    ),

  bulkUpdateUserRoles: adminProcedure
    .input(Schema.standardSchemaV1(BulkUpdateUserRolesInput))
    .mutation(({ ctx, input }) =>
      runProcedure(
        ctx.runtime,
        Effect.gen(function* () {
          const repo = yield* UserRepository;
          const { validUserIds, skippedCount } = yield* repo.filterProtectedUsers(
            { userIds: input.userIds, currentUserId: ctx.auth.user.id }
          );
          if (validUserIds.length === 0) {
            return yield* Effect.fail(
              new ValidationError({
                entity: "user",
                field: "userIds",
                message:
                  "No valid users to update (all selected users are protected)",
              })
            );
          }
          const affectedCount = yield* repo.bulkUpdateUserRoles({
            userIds: validUserIds,
            role: input.role,
          });
          return { success: true, affectedCount, skippedCount } as const;
        })
      )
    ),
});
