import { Effect } from "effect";
import { eq, inArray, count, desc, or, like, and, type SQL } from "drizzle-orm";
import { user } from "@/db/schema";
import { Database } from "@/services/database";
import {
  NotFoundError,
  UpdateError,
  DeletionError,
  ValidationError,
  QueryError,
} from "@/models/errors/repository";
import type {
  GetUsersInput,
  GetUserInput,
  UpdateUserInput,
  BanUserInput,
  UnbanUserInput,
  DeleteUserInput,
  BulkBanUsersInput,
  BulkDeleteUsersInput,
  BulkUpdateUserRolesInput,
  Role,
} from "@/lib/schemas/user";

export interface FilterProtectedInput {
  readonly userIds: ReadonlyArray<string>;
  readonly currentUserId: string;
}

export interface BulkUpdateUsersUnsafeInput {
  readonly updates: ReadonlyArray<{
    readonly userId: string;
    readonly data: {
      readonly name?: string;
      readonly email?: string;
      readonly role?: Role;
      readonly banned?: boolean;
      readonly banReason?: string;
      readonly banExpires?: Date;
      readonly verified?: boolean;
    };
  }>;
}

export const isProtectedUser = (
  target: { readonly role: string | null; readonly id: string },
  currentUserId: string
): boolean => target.role === "admin" || target.id === currentUserId;

export const buildUserConditions = (
  input: GetUsersInput
): SQL | undefined => {
  const conditions: SQL[] = [];
  if (input.search) {
    const term = `%${input.search}%`;
    const cond = or(like(user.name, term), like(user.email, term));
    if (cond) conditions.push(cond);
  }
  if (input.role) conditions.push(eq(user.role, input.role));
  if (input.status === "banned") conditions.push(eq(user.banned, true));
  else if (input.status === "verified")
    conditions.push(eq(user.emailVerified, true));
  else if (input.status === "unverified")
    conditions.push(eq(user.emailVerified, false));
  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return and(...conditions);
};

export class UserRepository extends Effect.Service<UserRepository>()(
  "app/UserRepository",
  {
    effect: Effect.gen(function* () {
      const { db } = yield* Database;

      const getUsers = (input: GetUsersInput) =>
        Effect.gen(function* () {
          const offset = input.page * input.limit;
          const condition = buildUserConditions(input);

          const [users, totalCountResult] = yield* Effect.all(
            [
              Effect.tryPromise({
                try: () =>
                  db
                    .select()
                    .from(user)
                    .where(condition)
                    .orderBy(desc(user.createdAt))
                    .limit(input.limit)
                    .offset(offset),
                catch: (cause) =>
                  new QueryError({ entity: "user", cause }),
              }),
              Effect.tryPromise({
                try: () =>
                  db
                    .select({ count: count() })
                    .from(user)
                    .where(condition),
                catch: (cause) =>
                  new QueryError({ entity: "user", cause }),
              }),
            ],
            { concurrency: "unbounded" }
          );

          const total = totalCountResult[0]?.count ?? 0;
          return {
            users,
            total,
            page: input.page,
            limit: input.limit,
            totalPages: Math.ceil(total / input.limit),
          };
        });

      const filterProtectedUsers = (input: FilterProtectedInput) =>
        Effect.gen(function* () {
          if (input.userIds.length === 0) {
            return { validUserIds: [] as string[], skippedCount: 0 };
          }
          const usersToCheck = yield* Effect.tryPromise({
            try: () =>
              db
                .select({ id: user.id, role: user.role })
                .from(user)
                .where(inArray(user.id, [...input.userIds])),
            catch: (cause) => new QueryError({ entity: "user", cause }),
          });
          const validUserIds = usersToCheck
            .filter((u) => !isProtectedUser(u, input.currentUserId))
            .map((u) => u.id);
          return {
            validUserIds,
            skippedCount: input.userIds.length - validUserIds.length,
          };
        });

      const bulkBanUsers = (input: BulkBanUsersInput) =>
        input.userIds.length === 0
          ? Effect.succeed(0)
          : Effect.tryPromise({
              try: async () => {
                await db
                  .update(user)
                  .set({
                    banned: true,
                    banReason: input.reason ?? null,
                    banExpires: input.expiresAt ?? null,
                  })
                  .where(inArray(user.id, [...input.userIds]));
                return input.userIds.length;
              },
              catch: (cause) => new UpdateError({ entity: "user", cause }),
            });

      const bulkDeleteUsers = (input: BulkDeleteUsersInput) =>
        input.userIds.length === 0
          ? Effect.succeed(0)
          : Effect.tryPromise({
              try: async () => {
                await db
                  .delete(user)
                  .where(inArray(user.id, [...input.userIds]));
                return input.userIds.length;
              },
              catch: (cause) => new DeletionError({ entity: "user", cause }),
            });

      const bulkUpdateUserRoles = (input: BulkUpdateUserRolesInput) =>
        input.userIds.length === 0
          ? Effect.succeed(0)
          : Effect.tryPromise({
              try: async () => {
                await db
                  .update(user)
                  .set({ role: input.role })
                  .where(inArray(user.id, [...input.userIds]));
                return input.userIds.length;
              },
              catch: (cause) => new UpdateError({ entity: "user", cause }),
            });

      const getUser = (input: GetUserInput) =>
        Effect.gen(function* () {
          const found = yield* Effect.tryPromise({
            try: () =>
              db
                .select()
                .from(user)
                .where(eq(user.id, input.userId))
                .limit(1),
            catch: (cause) => new QueryError({ entity: "user", cause }),
          });
          if (found.length === 0) {
            return yield* Effect.fail(
              new NotFoundError({ entity: "user", identifier: input.userId })
            );
          }
          return found[0];
        });

      const assertMutable = (input: { userId: string; currentUserId: string }) =>
        Effect.gen(function* () {
          const target = yield* Effect.tryPromise({
            try: () =>
              db
                .select({ id: user.id, role: user.role })
                .from(user)
                .where(eq(user.id, input.userId))
                .limit(1),
            catch: (cause) => new QueryError({ entity: "user", cause }),
          });
          if (target.length === 0) {
            return yield* Effect.fail(
              new NotFoundError({ entity: "user", identifier: input.userId })
            );
          }
          if (isProtectedUser(target[0], input.currentUserId)) {
            return yield* Effect.fail(
              new ValidationError({
                entity: "user",
                message: "Cannot modify admin users or yourself",
                field: "userId",
              })
            );
          }
          return target[0];
        });

      const updateUser = (
        input: UpdateUserInput & { currentUserId: string }
      ) =>
        Effect.gen(function* () {
          yield* assertMutable({
            userId: input.userId,
            currentUserId: input.currentUserId,
          });
          yield* Effect.tryPromise({
            try: () =>
              db
                .update(user)
                .set({
                  name: input.data.name,
                  email: input.data.email,
                  role: input.data.role,
                  banned: input.data.banned,
                  banReason: input.data.banReason,
                  banExpires: input.data.banExpires,
                  emailVerified: input.data.verified,
                })
                .where(eq(user.id, input.userId)),
            catch: (cause) => new UpdateError({ entity: "user", cause }),
          });
          return { success: true } as const;
        });

      const banUser = (input: BanUserInput & { currentUserId: string }) =>
        Effect.gen(function* () {
          yield* assertMutable({
            userId: input.userId,
            currentUserId: input.currentUserId,
          });
          yield* Effect.tryPromise({
            try: () =>
              db
                .update(user)
                .set({
                  banned: true,
                  banReason: input.reason ?? null,
                  banExpires: input.expiresAt ?? null,
                })
                .where(eq(user.id, input.userId)),
            catch: (cause) => new UpdateError({ entity: "user", cause }),
          });
          return { success: true } as const;
        });

      const unbanUser = (input: UnbanUserInput) =>
        Effect.gen(function* () {
          const target = yield* Effect.tryPromise({
            try: () =>
              db
                .select({ id: user.id })
                .from(user)
                .where(eq(user.id, input.userId))
                .limit(1),
            catch: (cause) => new QueryError({ entity: "user", cause }),
          });
          if (target.length === 0) {
            return yield* Effect.fail(
              new NotFoundError({ entity: "user", identifier: input.userId })
            );
          }
          yield* Effect.tryPromise({
            try: () =>
              db
                .update(user)
                .set({
                  banned: false,
                  banReason: null,
                  banExpires: null,
                })
                .where(eq(user.id, input.userId)),
            catch: (cause) => new UpdateError({ entity: "user", cause }),
          });
          return { success: true } as const;
        });

      const deleteUser = (
        input: DeleteUserInput & { currentUserId: string }
      ) =>
        Effect.gen(function* () {
          yield* assertMutable({
            userId: input.userId,
            currentUserId: input.currentUserId,
          });
          yield* Effect.tryPromise({
            try: () =>
              db.delete(user).where(eq(user.id, input.userId)),
            catch: (cause) => new DeletionError({ entity: "user", cause }),
          });
          return { success: true } as const;
        });

      const bulkUpdateUsersUnsafe = (input: BulkUpdateUsersUnsafeInput) =>
        input.updates.length === 0
          ? Effect.succeed(0)
          : Effect.tryPromise({
              try: async () => {
                await Promise.all(
                  input.updates.map((update) =>
                    db
                      .update(user)
                      .set({
                        name: update.data.name,
                        email: update.data.email,
                        role: update.data.role,
                        banned: update.data.banned,
                        banReason: update.data.banReason,
                        banExpires: update.data.banExpires,
                        emailVerified: update.data.verified,
                      })
                      .where(eq(user.id, update.userId))
                  )
                );
                return input.updates.length;
              },
              catch: (cause) => new UpdateError({ entity: "user", cause }),
            });

      return {
        getUsers,
        filterProtectedUsers,
        bulkBanUsers,
        bulkDeleteUsers,
        bulkUpdateUserRoles,
        getUser,
        updateUser,
        banUser,
        unbanUser,
        deleteUser,
        bulkUpdateUsersUnsafe,
      } as const;
    }),
  }
) {}
