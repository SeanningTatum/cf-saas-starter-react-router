import { Effect, Schema } from "effect";
import { adminProcedure, createTRPCRouter } from "..";
import { runProcedure } from "@/lib/effect-trpc";
import { UserRepository } from "@/repositories/user";
import type { AppRuntime } from "@/runtime";
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

/**
 * Shared shape for the three `bulk*` procedures below: filter out
 * protected users (self/admin) → bail early with a zero-affected result if
 * nothing is left → run the repo action on the remaining ids → log a
 * structured `logEvent` with actor/targets/affectedCount/skippedCount (plus
 * any `extraLogFields`, e.g. the new role for `bulkUpdateUserRoles`).
 */
function runBulkUserAction<E>(
  ctx: { runtime: AppRuntime; auth: { user: { id: string } } },
  userIds: readonly string[],
  logEvent: string,
  span: string,
  performAction: (
    repo: UserRepository,
    validUserIds: string[]
  ) => Effect.Effect<number, E>,
  extraLogFields: Record<string, unknown> = {}
) {
  return runProcedure(
    ctx.runtime,
    Effect.gen(function* () {
      const repo = yield* UserRepository;
      const { validUserIds, skippedCount } = yield* repo.filterProtectedUsers({
        userIds: [...userIds],
        currentUserId: ctx.auth.user.id,
      });
      if (validUserIds.length === 0) {
        return { success: true, affectedCount: 0, skippedCount } as const;
      }
      const affectedCount = yield* performAction(repo, validUserIds);
      return { success: true, affectedCount, skippedCount } as const;
    }).pipe(
      Effect.tap((result) =>
        Effect.logInfo(logEvent).pipe(
          Effect.annotateLogs({
            actor: ctx.auth.user.id,
            targets: userIds,
            affectedCount: result.affectedCount,
            skippedCount: result.skippedCount,
            ...extraLogFields,
          })
        )
      )
    ),
    { span }
  );
}

export const adminRouter = createTRPCRouter({
  getUsers: adminProcedure
    .input(Schema.standardSchemaV1(GetUsersInput))
    .query(({ ctx, input }) =>
      runProcedure(
        ctx.runtime,
        Effect.gen(function* () {
          const repo = yield* UserRepository;
          return yield* repo.getUsers(input);
        }),
        { span: "trpc.admin.getUsers" }
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
        }),
        { span: "trpc.admin.getUser" }
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
        }),
        { span: "trpc.admin.updateUser" }
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
        }),
        { span: "trpc.admin.banUser" }
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
        }),
        { span: "trpc.admin.unbanUser" }
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
        }),
        { span: "trpc.admin.deleteUser" }
      )
    ),

  bulkBanUsers: adminProcedure
    .input(Schema.standardSchemaV1(BulkBanUsersInput))
    .mutation(({ ctx, input }) =>
      runBulkUserAction(ctx, input.userIds, "users.bulk_banned", "trpc.admin.bulkBanUsers", (repo, validUserIds) =>
        repo.bulkBanUsers({
          userIds: validUserIds,
          reason: input.reason,
          expiresAt: input.expiresAt,
        })
      )
    ),

  bulkDeleteUsers: adminProcedure
    .input(Schema.standardSchemaV1(BulkDeleteUsersInput))
    .mutation(({ ctx, input }) =>
      runBulkUserAction(ctx, input.userIds, "users.bulk_deleted", "trpc.admin.bulkDeleteUsers", (repo, validUserIds) =>
        repo.bulkDeleteUsers({ userIds: validUserIds })
      )
    ),

  bulkUpdateUserRoles: adminProcedure
    .input(Schema.standardSchemaV1(BulkUpdateUserRolesInput))
    .mutation(({ ctx, input }) =>
      runBulkUserAction(
        ctx,
        input.userIds,
        "users.bulk_role_updated",
        "trpc.admin.bulkUpdateUserRoles",
        (repo, validUserIds) =>
          repo.bulkUpdateUserRoles({ userIds: validUserIds, role: input.role }),
        { role: input.role }
      )
    ),
});
