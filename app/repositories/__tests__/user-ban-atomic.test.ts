import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { eq, sql } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { session, user } from "@/db/schema";
import { UpdateError } from "@/models/errors/repository";
import { Database } from "@/services/database";
import { makeSeededDatabase } from "@/services/database.seeded-layer";
import { UserRepository } from "../user";

const TARGET = "seed-user-001";
const ACTOR = "seed-admin";
const BLOCK_SESSION_DELETE = sql.raw(
  "CREATE TRIGGER block_session_delete BEFORE DELETE ON session BEGIN SELECT RAISE(ABORT, 'session delete blocked'); END",
);

const seeded = () =>
  UserRepository.Default.pipe(Layer.provideMerge(makeSeededDatabase("many-users")));

const signInThenBlockSessionDelete = Effect.gen(function* () {
  const { db } = yield* Database;
  yield* Effect.promise(() =>
    db.insert(session).values({
      id: `s-${TARGET}`,
      token: `t-${TARGET}`,
      userId: TARGET,
      expiresAt: new Date("2999-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    }),
  );
  yield* Effect.promise(() => db.run(BLOCK_SESSION_DELETE));
});

const targetState = Effect.gen(function* () {
  const { db } = yield* Database;
  const [row] = yield* Effect.promise(() =>
    db.select({ banned: user.banned }).from(user).where(eq(user.id, TARGET)),
  );
  const sessions = yield* Effect.promise(() =>
    db.select({ id: session.id }).from(session).where(eq(session.userId, TARGET)),
  );
  return { banned: row?.banned, sessions: sessions.length };
});

interface BanPath {
  readonly name: string;
  readonly run: (repo: UserRepository) => Effect.Effect<unknown, unknown>;
}

const bans: ReadonlyArray<BanPath> = [
  {
    name: "banUser",
    run: (repo: UserRepository) => repo.banUser({ userId: TARGET, currentUserId: ACTOR }),
  },
  {
    name: "bulkBanUsers",
    run: (repo: UserRepository) => repo.bulkBanUsers({ userIds: [TARGET] }),
  },
  {
    name: "updateUser with banned: true",
    run: (repo: UserRepository) =>
      repo.updateUser({ userId: TARGET, currentUserId: ACTOR, data: { banned: true } }),
  },
];

describe("UserRepository ban writes are one batch on real SQL", () => {
  for (const ban of bans) {
    it.effect(
      `${ban.name} leaves the user unbanned when ending the sessions fails, so a ban and its session delete never land apart`,
      () =>
        Effect.gen(function* () {
          const repo = yield* UserRepository;
          yield* signInThenBlockSessionDelete;
          const error = yield* Effect.flip(ban.run(repo));
          expect(error).toBeInstanceOf(UpdateError);
          expect(yield* targetState).toEqual({ banned: false, sessions: 1 });
        }).pipe(Effect.provide(seeded())),
    );
  }
});
