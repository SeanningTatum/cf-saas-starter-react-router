import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { account, session, upload, user } from "@/db/schema";
import { Database } from "@/services/database";
import { UploadRepository } from "@/repositories/upload";
import { tryDelete, tryQuery, requireFound } from "@/lib/effect-utils";
import { ValidationError } from "@/models/errors/repository";
import { hasAdminRole } from "@/auth/protected-user";
import { ADMIN_SELF_DELETE_MESSAGE } from "@/lib/constants/admin";

export class AccountRepository extends Effect.Service<AccountRepository>()(
  "app/AccountRepository",
  {
    dependencies: [UploadRepository.Default],
    effect: Effect.gen(function* () {
      const { db } = yield* Database;
      const uploads = yield* UploadRepository;

      const exportData = (userId: string) =>
        Effect.gen(function* () {
          const [profiles, sessions, accounts, files] = yield* Effect.all(
            [
              tryQuery("user", () =>
                db
                  .select({
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    emailVerified: user.emailVerified,
                    image: user.image,
                    role: user.role,
                    createdAt: user.createdAt,
                  })
                  .from(user)
                  .where(eq(user.id, userId))
                  .limit(1),
              ),
              tryQuery("session", () =>
                db
                  .select({
                    id: session.id,
                    createdAt: session.createdAt,
                    expiresAt: session.expiresAt,
                    ipAddress: session.ipAddress,
                    userAgent: session.userAgent,
                  })
                  .from(session)
                  .where(eq(session.userId, userId)),
              ),
              tryQuery("account", () =>
                db
                  .select({
                    id: account.id,
                    providerId: account.providerId,
                    createdAt: account.createdAt,
                  })
                  .from(account)
                  .where(eq(account.userId, userId)),
              ),
              tryQuery("upload", () =>
                db
                  .select({
                    id: upload.id,
                    key: upload.key,
                    contentType: upload.contentType,
                    size: upload.size,
                    createdAt: upload.createdAt,
                  })
                  .from(upload)
                  .where(eq(upload.userId, userId)),
              ),
            ],
            { concurrency: "unbounded" },
          );
          const profile = yield* requireFound("user", userId, profiles[0]);
          return { profile, sessions, accounts, uploads: files } as const;
        });

      const deleteAccount = (userId: string) =>
        Effect.gen(function* () {
          const rows = yield* tryQuery("user", () =>
            db.select({ id: user.id, role: user.role }).from(user).where(eq(user.id, userId)),
          );
          const found = yield* requireFound("user", userId, rows[0]);
          if (hasAdminRole(found.role)) {
            return yield* Effect.fail(
              new ValidationError({
                entity: "user",
                field: "userId",
                message: ADMIN_SELF_DELETE_MESSAGE,
              }),
            );
          }
          yield* uploads.purgeForUsers([userId]);
          yield* tryDelete("user", () => db.delete(user).where(eq(user.id, userId)));
          return { success: true } as const;
        });

      return { exportData, deleteAccount } as const;
    }),
  },
) {}
