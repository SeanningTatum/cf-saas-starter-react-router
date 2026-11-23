import { describe, expect, it as itVitest } from "vitest";
import { it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { user } from "@/db/schema";
import type { UpdateUserInput } from "@/lib/schemas/user";
import { Database } from "@/services/database";
import { makeSeededDatabase } from "@/services/database.seeded-layer";
import { UserRepository, emailVerifiedAfterUpdate } from "../user";

const TARGET = "seed-user";
const ACTOR = "seed-admin";
const STORED_EMAIL = "user@preview.local";
const FAR_AHEAD = new Date("2999-01-01T00:00:00Z");
const PAST = new Date("2020-01-01T00:00:00Z");

const seeded = () => UserRepository.Default.pipe(Layer.provideMerge(makeSeededDatabase("base")));

const rowAfter = (data: UpdateUserInput["data"], before: Partial<typeof user.$inferInsert> = {}) =>
  Effect.gen(function* () {
    const { db } = yield* Database;
    const repo = yield* UserRepository;
    if (Object.keys(before).length > 0) {
      yield* Effect.promise(() => db.update(user).set(before).where(eq(user.id, TARGET)));
    }
    yield* repo.updateUser({ userId: TARGET, currentUserId: ACTOR, data });
    const rows = yield* Effect.promise(() => db.select().from(user).where(eq(user.id, TARGET)));
    return rows[0];
  }).pipe(Effect.provide(seeded()));

describe("UserRepository.updateUser writes the ban expiry", () => {
  it.effect(
    "writes a null expiry for a ban with none, so an old past expiry cannot end the new ban",
    () =>
      Effect.gen(function* () {
        const row = yield* rowAfter({ banned: true }, { banExpires: PAST });
        expect(row).toMatchObject({ banned: true, banExpires: null });
      }),
  );

  it.effect("keeps the expiry the admin sent with the ban", () =>
    Effect.gen(function* () {
      const row = yield* rowAfter({ banned: true, banExpires: FAR_AHEAD });
      expect(row?.banExpires).toEqual(FAR_AHEAD);
    }),
  );

  it.effect("leaves the expiry untouched on an update that does not ban", () =>
    Effect.gen(function* () {
      const row = yield* rowAfter({ name: "N" }, { banExpires: FAR_AHEAD });
      expect(row?.banExpires).toEqual(FAR_AHEAD);
    }),
  );
});

describe("UserRepository.updateUser resets emailVerified on an email change", () => {
  it.effect(
    "writes emailVerified: false for a new email even when the admin sends verified: true",
    () =>
      Effect.gen(function* () {
        const row = yield* rowAfter({ email: "new@example.test", verified: true });
        expect(row).toMatchObject({ email: "new@example.test", emailVerified: false });
      }),
  );

  it.effect("keeps emailVerified for an update that sends the stored email", () =>
    Effect.gen(function* () {
      const row = yield* rowAfter({ email: STORED_EMAIL, verified: true });
      expect(row?.emailVerified).toBe(true);
    }),
  );
});

describe("emailVerifiedAfterUpdate", () => {
  itVitest.each([
    ["a changed email, verified: true", { email: "b@x.test", verified: true }, false],
    ["a changed email, no flag", { email: "b@x.test" }, false],
    ["the same email, verified: true", { email: "a@x.test", verified: true }, true],
    ["no email, verified: false", { verified: false }, false],
    ["no email, no flag", {}, undefined],
  ])("%s -> %s", (_label, data, expected) => {
    expect(emailVerifiedAfterUpdate("a@x.test", data)).toBe(expected);
  });
});
