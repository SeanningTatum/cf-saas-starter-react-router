import { Effect } from "effect";
import { and, eq, sql } from "drizzle-orm";
import { upload } from "@/db/schema";
import { Database } from "@/services/database";
import { BucketRepository } from "@/repositories/bucket";
import { tryCreate, tryDelete, tryQuery, requireFound } from "@/lib/effect-utils";
import { UploadQuotaError } from "@/models/errors/bucket";
import {
  R2_DELETE_BATCH_SIZE,
  R2_LIST_PAGE_SIZE,
  UPLOAD_QUOTA_BYTES,
  UPLOAD_QUOTA_MESSAGE,
  uploadKeyFor,
  uploadPrefixFor,
} from "@/lib/constants/upload";
import { UPLOAD_PURGE_SPAN, UPLOAD_RESERVE_SPAN } from "@/lib/constants/spans";

export interface StoreUploadInput {
  readonly userId: string;
  readonly file: File;
  readonly contentType: string;
}

const quotaError = () =>
  new UploadQuotaError({
    limitBytes: UPLOAD_QUOTA_BYTES,
    message: UPLOAD_QUOTA_MESSAGE,
  });

const chunk = <A>(items: ReadonlyArray<A>, size: number): ReadonlyArray<ReadonlyArray<A>> =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );

export class UploadRepository extends Effect.Service<UploadRepository>()("app/UploadRepository", {
  dependencies: [BucketRepository.Default],
  effect: Effect.gen(function* () {
    const { db } = yield* Database;
    const bucket = yield* BucketRepository;

    const usedBytes = (userId: string) =>
      tryQuery("upload", () =>
        db
          .select({ total: sql<number>`coalesce(sum(${upload.size}), 0)` })
          .from(upload)
          .where(eq(upload.userId, userId)),
      ).pipe(Effect.map((rows) => Number(rows[0]?.total ?? 0)));

    const assertRoom = (userId: string, incomingBytes: number) =>
      Effect.gen(function* () {
        const used = yield* usedBytes(userId);
        if (used + incomingBytes > UPLOAD_QUOTA_BYTES) {
          return yield* Effect.fail(quotaError());
        }
      });

    const release = (id: string) =>
      tryDelete("upload", () => db.delete(upload).where(eq(upload.id, id)));

    const reserve = (row: typeof upload.$inferInsert) =>
      Effect.gen(function* () {
        yield* tryCreate("upload", () => db.insert(upload).values(row));
        yield* Effect.gen(function* () {
          const used = yield* usedBytes(row.userId);
          if (used > UPLOAD_QUOTA_BYTES) {
            return yield* Effect.fail(quotaError());
          }
        }).pipe(Effect.tapError(() => Effect.ignore(release(row.id))));
      }).pipe(Effect.withSpan(UPLOAD_RESERVE_SPAN));

    const findOwned = (userId: string, id: string) =>
      Effect.gen(function* () {
        const rows = yield* tryQuery("upload", () =>
          db
            .select()
            .from(upload)
            .where(and(eq(upload.id, id), eq(upload.userId, userId)))
            .limit(1),
        );
        return yield* requireFound("upload", id, rows[0]);
      });

    const store = (input: StoreUploadInput) =>
      Effect.gen(function* () {
        const id = crypto.randomUUID();
        const key = uploadKeyFor(input.userId, id);
        yield* reserve({
          id,
          userId: input.userId,
          key,
          contentType: input.contentType,
          size: input.file.size,
        });
        yield* bucket
          .upload(input.file, { key, contentType: input.contentType })
          .pipe(Effect.tapError(() => Effect.ignore(release(id))));
        yield* findOwned(input.userId, id).pipe(
          Effect.tapError(() => Effect.ignore(Effect.all([bucket.remove(key), release(id)]))),
        );
        return { id, key } as const;
      });

    const readOwned = (userId: string, id: string) =>
      Effect.gen(function* () {
        const row = yield* findOwned(userId, id);
        const object = yield* bucket.get(row.key);
        return { row, object } as const;
      });

    const removeOwned = (userId: string, id: string) =>
      Effect.gen(function* () {
        const row = yield* findOwned(userId, id);
        yield* bucket.remove(row.key);
        yield* release(row.id);
        return { success: true } as const;
      });

    const listFor = (userId: string) =>
      tryQuery("upload", () => db.select().from(upload).where(eq(upload.userId, userId)));

    const sweepKeys = (prefix: string) =>
      Effect.gen(function* () {
        const keys: string[] = [];
        let cursor: string | undefined;
        do {
          const page = yield* bucket.list({ prefix, limit: R2_LIST_PAGE_SIZE, cursor });
          keys.push(...page.objects.map((o) => o.key));
          cursor = page.truncated ? page.cursor : undefined;
        } while (cursor !== undefined);
        return keys;
      });

    const purgeOne = (userId: string) =>
      Effect.gen(function* () {
        const rows = yield* tryQuery("upload", () =>
          db.select({ key: upload.key }).from(upload).where(eq(upload.userId, userId)),
        );
        yield* tryDelete("upload", () => db.delete(upload).where(eq(upload.userId, userId)));
        const swept = yield* sweepKeys(uploadPrefixFor(userId));
        const keys = [...new Set([...rows.map((r) => r.key), ...swept])];
        yield* Effect.forEach(chunk(keys, R2_DELETE_BATCH_SIZE), (batch) => bucket.remove(batch), {
          discard: true,
        });
      });

    const purgeForUsers = (userIds: ReadonlyArray<string>) =>
      Effect.forEach(userIds, purgeOne, { discard: true }).pipe(Effect.withSpan(UPLOAD_PURGE_SPAN));

    return {
      usedBytes,
      assertRoom,
      store,
      readOwned,
      removeOwned,
      listFor,
      purgeForUsers,
    } as const;
  }),
}) {}
