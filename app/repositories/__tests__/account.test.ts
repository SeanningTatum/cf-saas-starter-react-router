import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { session, upload, user } from "@/db/schema";
import { uploadKeyFor } from "@/lib/constants/upload";
import { ValidationError, NotFoundError } from "@/models/errors/repository";
import { makeFakeBucket } from "@/services/__tests__/fake-bucket";
import { Database } from "@/services/database";
import { makeSeededDatabase } from "@/services/database.seeded-layer";
import { AccountRepository } from "../account";

const PLAIN = "seed-user";
const OTHER = "seed-banned";
const ADMIN = "seed-admin";

const setup = () => {
  const bucket = makeFakeBucket();
  const layer = AccountRepository.Default.pipe(
    Layer.provideMerge(bucket.layer),
    Layer.provideMerge(makeSeededDatabase("base")),
  );
  return { bucket, layer };
};

const addSession = (userId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database;
    yield* Effect.promise(() =>
      db.insert(session).values({
        id: `s-${userId}`,
        userId,
        token: `t-${userId}`,
        expiresAt: new Date(9_999_999_999_999),
        updatedAt: new Date(1),
      }),
    );
  });

const countOf = (table: typeof user | typeof session | typeof upload, userId: string) =>
  Effect.gen(function* () {
    const { db } = yield* Database;
    const column = "userId" in table ? table.userId : table.id;
    return (yield* Effect.promise(() => db.select().from(table).where(eq(column, userId)))).length;
  });

describe("AccountRepository.exportData", () => {
  it.effect(
    "returns the caller's rows under four headings and leaves out every secret column",
    () => {
      const { layer } = setup();
      return Effect.gen(function* () {
        yield* addSession(PLAIN);
        const repo = yield* AccountRepository;

        const exported = yield* repo.exportData(PLAIN);

        expect(Object.keys(exported).sort()).toEqual([
          "accounts",
          "profile",
          "sessions",
          "uploads",
        ]);
        expect(exported.profile.id).toBe(PLAIN);
        expect(exported.sessions).toHaveLength(1);
        expect(Object.keys(exported.sessions[0] ?? {})).not.toContain("token");
        expect(Object.keys(exported.accounts[0] ?? {})).not.toContain("password");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("fails with not found for an id that is no user", () => {
    const { layer } = setup();
    return Effect.gen(function* () {
      const repo = yield* AccountRepository;
      expect(yield* Effect.flip(repo.exportData("ghost"))).toBeInstanceOf(NotFoundError);
    }).pipe(Effect.provide(layer));
  });
});

describe("AccountRepository.deleteAccount", () => {
  it.effect("removes the user, their sessions, upload rows and objects, and nobody else's", () => {
    const { bucket, layer } = setup();
    return Effect.gen(function* () {
      yield* addSession(PLAIN);
      yield* addSession(OTHER);
      bucket.seed(uploadKeyFor(PLAIN, `${PLAIN}-upload`));
      bucket.seed(uploadKeyFor(OTHER, `${OTHER}-upload`));
      const repo = yield* AccountRepository;

      yield* repo.deleteAccount(PLAIN);

      expect(yield* countOf(user, PLAIN)).toBe(0);
      expect(yield* countOf(session, PLAIN)).toBe(0);
      expect(yield* countOf(upload, PLAIN)).toBe(0);
      expect(bucket.keys()).toEqual([uploadKeyFor(OTHER, `${OTHER}-upload`)]);
      expect(yield* countOf(user, OTHER)).toBe(1);
      expect(yield* countOf(session, OTHER)).toBe(1);
      expect(yield* countOf(upload, OTHER)).toBe(1);
    }).pipe(Effect.provide(layer));
  });

  it.effect("refuses an admin and changes nothing", () => {
    const { bucket, layer } = setup();
    return Effect.gen(function* () {
      bucket.seed(uploadKeyFor(ADMIN, `${ADMIN}-upload`));
      const repo = yield* AccountRepository;

      expect(yield* Effect.flip(repo.deleteAccount(ADMIN))).toBeInstanceOf(ValidationError);

      expect(yield* countOf(user, ADMIN)).toBe(1);
      expect(bucket.keys()).toHaveLength(1);
    }).pipe(Effect.provide(layer));
  });
});
