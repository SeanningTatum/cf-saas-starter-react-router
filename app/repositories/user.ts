import { Effect } from "effect";
import { eq, inArray, count, desc, or, like, and, type SQL } from "drizzle-orm";
import { user } from "@/db/schema";
import { Database } from "@/services/database";
import { tryQuery, tryUpdate, tryDelete, requireFound } from "@/lib/effect-utils";
import { ValidationError } from "@/models/errors/repository";
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
} from "@/lib/schemas/user";

export interface FilterProtectedInput {
  readonly userIds: ReadonlyArray<string>;
  readonly currentUserId: string;
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
              tryQuery("user", () =>
                db
                  .select()
                  .from(user)
                  .where(condition)
                  .orderBy(desc(user.createdAt))
                  .limit(input.limit)
                  .offset(offset)
              ),
              tryQuery("user", () =>
                db.select({ count: count() }).from(user).where(condition)
              ),
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
          const usersToCheck = yield* tryQuery("user", () =>
            db
              .select({ id: user.id, role: user.role })
              .from(user)
              .where(inArray(user.id, [...input.userIds]))
          );
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
          : tryUpdate("user", async () => {
              await db
                .update(user)
                .set({
                  banned: true,
                  banReason: input.reason ?? null,
                  banExpires: input.expiresAt ?? null,
                })
                .where(inArray(user.id, [...input.userIds]));
              return input.userIds.length;
            });

      const bulkDeleteUsers = (input: BulkDeleteUsersInput) =>
        input.userIds.length === 0
          ? Effect.succeed(0)
          : tryDelete("user", async () => {
              await db.delete(user).where(inArray(user.id, [...input.userIds]));
              return input.userIds.length;
            });

      const bulkUpdateUserRoles = (input: BulkUpdateUserRolesInput) =>
        input.userIds.length === 0
          ? Effect.succeed(0)
          : tryUpdate("user", async () => {
              await db
                .update(user)
                .set({ role: input.role })
                .where(inArray(user.id, [...input.userIds]));
              return input.userIds.length;
            });

      const getUser = (input: GetUserInput) =>
        Effect.gen(function* () {
          const found = yield* tryQuery("user", () =>
            db.select().from(user).where(eq(user.id, input.userId)).limit(1)
          );
          return yield* requireFound("user", input.userId, found[0]);
        });

      const assertMutable = (input: { userId: string; currentUserId: string }) =>
        Effect.gen(function* () {
          const target = yield* tryQuery("user", () =>
            db
              .select({ id: user.id, role: user.role })
              .from(user)
              .where(eq(user.id, input.userId))
              .limit(1)
          );
          const found = yield* requireFound("user", input.userId, target[0]);
          if (isProtectedUser(found, input.currentUserId)) {
            return yield* Effect.fail(
              new ValidationError({
                entity: "user",
                message: "Cannot modify admin users or yourself",
                field: "userId",
              })
            );
          }
          return found;
        });

      const updateUser = (
        input: UpdateUserInput & { currentUserId: string }
      ) =>
        Effect.gen(function* () {
          yield* assertMutable({
            userId: input.userId,
            currentUserId: input.currentUserId,
          });
          yield* tryUpdate("user", () =>
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
              .where(eq(user.id, input.userId))
          );
          return { success: true } as const;
        });

      const banUser = (input: BanUserInput & { currentUserId: string }) =>
        Effect.gen(function* () {
          yield* assertMutable({
            userId: input.userId,
            currentUserId: input.currentUserId,
          });
          yield* tryUpdate("user", () =>
            db
              .update(user)
              .set({
                banned: true,
                banReason: input.reason ?? null,
                banExpires: input.expiresAt ?? null,
              })
              .where(eq(user.id, input.userId))
          );
          return { success: true } as const;
        });

      const unbanUser = (input: UnbanUserInput) =>
        Effect.gen(function* () {
          const target = yield* tryQuery("user", () =>
            db.select({ id: user.id }).from(user).where(eq(user.id, input.userId)).limit(1)
          );
          yield* requireFound("user", input.userId, target[0]);
          yield* tryUpdate("user", () =>
            db
              .update(user)
              .set({
                banned: false,
                banReason: null,
                banExpires: null,
              })
              .where(eq(user.id, input.userId))
          );
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
          yield* tryDelete("user", () => db.delete(user).where(eq(user.id, input.userId)));
          return { success: true } as const;
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
      } as const;
    }),
  }
) {}
