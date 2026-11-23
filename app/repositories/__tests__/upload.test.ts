import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { Effect, Exit, Layer } from "effect";
import { upload } from "@/db/schema";
import { UPLOAD_QUOTA_BYTES, uploadKeyFor, uploadPrefixFor } from "@/lib/constants/upload";
import { NotFoundError } from "@/models/errors/repository";
import { makeFakeBucket } from "@/services/__tests__/fake-bucket";
import { Database } from "@/services/database";
import { makeSeededDatabase } from "@/services/database.seeded-layer";
import { UploadRepository } from "../upload";

const OWNER = "seed-user";
const OTHER = "seed-admin";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const png = (size = PNG.length) => new File([new Uint8Array(size)], "a.png", { type: "image/png" });

const setup = () => {
  const bucket = makeFakeBucket();
  const layer = UploadRepository.Default.pipe(
    Layer.provideMerge(bucket.layer),
    Layer.provideMerge(makeSeededDatabase("base")),
  );
  return { bucket, layer };
};

const rowsFor = (userId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database;
    return yield* Effect.promise(() => db.select().from(upload).where(eq(upload.userId, userId)));
  });

const fillQuota = (userId: string, size: number) =>
  Effect.gen(function* () {
    const { db } = yield* Database;
    yield* Effect.promise(() =>
      db.insert(upload).values({
        id: `${userId}-filler`,
        userId,
        key: uploadKeyFor(userId, "filler"),
        contentType: "image/png",
        size,
      }),
    );
  });

describe("UploadRepository.store", () => {
  it.effect(
    "writes the object under the owner's prefix and records the owner, so every object has a row that names who owns it",
    () => {
      const { bucket, layer } = setup();
      return Effect.gen(function* () {
        const repo = yield* UploadRepository;
        const stored = yield* repo.store({
          userId: OWNER,
          file: png(),
          contentType: "image/png",
        });

        expect(stored.key.startsWith(uploadPrefixFor(OWNER))).toBe(true);
        expect(bucket.keys()).toContain(stored.key);
        const rows = (yield* rowsFor(OWNER)).filter((row) => row.id === stored.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          userId: OWNER,
          key: stored.key,
          size: PNG.length,
        });
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "refuses an upload that would pass the quota and leaves no row and no object, so a refused upload costs nothing",
    () => {
      const { bucket, layer } = setup();
      return Effect.gen(function* () {
        yield* fillQuota(OWNER, UPLOAD_QUOTA_BYTES - 1);
        const repo = yield* UploadRepository;
        const before = (yield* rowsFor(OWNER)).length;

        const exit = yield* Effect.exit(
          repo.store({ userId: OWNER, file: png(2), contentType: "image/png" }),
        );

        expect(Exit.isFailure(exit) && String(exit.cause)).toContain("UploadQuotaError");
        expect((yield* rowsFor(OWNER)).length).toBe(before);
        expect(bucket.keys()).toEqual([]);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("counts the quota per user, so one user's full quota does not block another", () => {
    const { layer } = setup();
    return Effect.gen(function* () {
      yield* fillQuota(OWNER, UPLOAD_QUOTA_BYTES);
      const repo = yield* UploadRepository;

      const stored = yield* repo.store({
        userId: OTHER,
        file: png(),
        contentType: "image/png",
      });

      expect(stored.key.startsWith(uploadPrefixFor(OTHER))).toBe(true);
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "assertRoom fails before any body is read when the declared size would pass the quota",
    () => {
      const { layer } = setup();
      return Effect.gen(function* () {
        const repo = yield* UploadRepository;
        yield* repo.assertRoom(OWNER, UPLOAD_QUOTA_BYTES - 2048);
        const exit = yield* Effect.exit(repo.assertRoom(OWNER, UPLOAD_QUOTA_BYTES));
        expect(Exit.isFailure(exit) && String(exit.cause)).toContain("UploadQuotaError");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("drops the row when the put fails, so a failed put does not eat the quota", () => {
    const { bucket, layer } = setup();
    return Effect.gen(function* () {
      const repo = yield* UploadRepository;
      const before = (yield* rowsFor(OWNER)).length;
      bucket.failPut(true);

      const exit = yield* Effect.exit(
        repo.store({ userId: OWNER, file: png(), contentType: "image/png" }),
      );

      expect(Exit.isFailure(exit) && String(exit.cause)).toContain("BucketUploadError");
      expect((yield* rowsFor(OWNER)).length).toBe(before);
    }).pipe(Effect.provide(layer));
  });
});

describe("UploadRepository, ownership", () => {
  it.effect(
    "reads an object for its owner and refuses another user's id as not found, so one user cannot read another's file",
    () => {
      const { layer } = setup();
      return Effect.gen(function* () {
        const repo = yield* UploadRepository;
        const stored = yield* repo.store({
          userId: OWNER,
          file: png(),
          contentType: "image/png",
        });

        const mine = yield* repo.readOwned(OWNER, stored.id);
        const theirs = yield* Effect.flip(repo.readOwned(OTHER, stored.id));

        expect(mine.row.contentType).toBe("image/png");
        expect(theirs).toBeInstanceOf(NotFoundError);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "refuses another user's delete and keeps the object and the row, then lets the owner delete both",
    () => {
      const { bucket, layer } = setup();
      return Effect.gen(function* () {
        const repo = yield* UploadRepository;
        const stored = yield* repo.store({
          userId: OWNER,
          file: png(),
          contentType: "image/png",
        });

        const refused = yield* Effect.flip(repo.removeOwned(OTHER, stored.id));
        expect(refused).toBeInstanceOf(NotFoundError);
        expect(bucket.keys()).toContain(stored.key);

        yield* repo.removeOwned(OWNER, stored.id);
        expect(bucket.keys()).not.toContain(stored.key);
        expect((yield* rowsFor(OWNER)).some((row) => row.id === stored.id)).toBe(false);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("lists only the caller's uploads", () => {
    const { layer } = setup();
    return Effect.gen(function* () {
      const repo = yield* UploadRepository;
      yield* repo.store({
        userId: OWNER,
        file: png(),
        contentType: "image/png",
      });
      const listed = yield* repo.listFor(OTHER);
      expect(listed.every((row) => row.userId === OTHER)).toBe(true);
    }).pipe(Effect.provide(layer));
  });
});

describe("UploadRepository.purgeForUsers", () => {
  it.effect(
    "removes the users' objects, including one with no row, and their rows, and leaves other users alone",
    () => {
      const { bucket, layer } = setup();
      return Effect.gen(function* () {
        const repo = yield* UploadRepository;
        const mine = yield* repo.store({
          userId: OWNER,
          file: png(),
          contentType: "image/png",
        });
        const theirs = yield* repo.store({
          userId: OTHER,
          file: png(),
          contentType: "image/png",
        });
        const orphan = uploadKeyFor(OWNER, "orphan");
        bucket.seed(orphan);

        yield* repo.purgeForUsers([OWNER]);

        expect(bucket.keys()).toEqual([theirs.key]);
        expect(bucket.keys()).not.toContain(mine.key);
        expect(bucket.keys()).not.toContain(orphan);
        expect(yield* rowsFor(OWNER)).toEqual([]);
        expect((yield* rowsFor(OTHER)).some((row) => row.id === theirs.id)).toBe(true);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("does nothing for an empty list", () => {
    const { bucket, layer } = setup();
    return Effect.gen(function* () {
      const repo = yield* UploadRepository;
      yield* repo.store({
        userId: OWNER,
        file: png(),
        contentType: "image/png",
      });
      yield* repo.purgeForUsers([]);
      expect(bucket.keys()).toHaveLength(1);
    }).pipe(Effect.provide(layer));
  });
});
