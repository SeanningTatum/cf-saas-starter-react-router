import { describe, expect, it as itVitest, vi } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { UserRepository, emailVerifiedAfterUpdate } from "../user";
import { chainable, chainableSpy, makeTestDatabase } from "@/services/database.test-layer";
import type { UpdateUserInput } from "@/lib/schemas/user";

const STORED_EMAIL = "old@example.test";
const FAR_AHEAD = new Date("2999-01-01T00:00:00Z");

const writtenBy = (data: UpdateUserInput["data"]) => {
  const set = vi.fn((_values: Record<string, unknown>) => chainable(undefined));
  const stub = {
    select: () => chainable([{ id: "u1", role: "user", email: STORED_EMAIL }]),
    update: vi.fn(() => ({ set })),
    delete: chainableSpy(undefined),
    batch: vi.fn((_statements: ReadonlyArray<unknown>) => Promise.resolve([])),
  };
  return Effect.gen(function* () {
    const repo = yield* UserRepository;
    yield* repo.updateUser({ userId: "u1", currentUserId: "actor", data });
    return set.mock.calls[0]?.[0];
  }).pipe(
    Effect.provide(UserRepository.Default.pipe(Layer.provide(makeTestDatabase(stub))))
  );
};

describe("UserRepository.updateUser writes the ban expiry", () => {
  it.effect("writes a null expiry for a ban with none, so an old past expiry cannot end the new ban", () =>
    Effect.gen(function* () {
      expect(yield* writtenBy({ banned: true })).toMatchObject({ banned: true, banExpires: null });
    })
  );

  it.effect("keeps the expiry the admin sent with the ban", () =>
    Effect.gen(function* () {
      expect(yield* writtenBy({ banned: true, banExpires: FAR_AHEAD })).toMatchObject({
        banExpires: FAR_AHEAD,
      });
    })
  );

  it.effect("leaves the expiry untouched on an update that does not ban", () =>
    Effect.gen(function* () {
      expect((yield* writtenBy({ name: "N" }))?.banExpires).toBeUndefined();
    })
  );
});

describe("UserRepository.updateUser resets emailVerified on an email change", () => {
  it.effect("writes emailVerified: false for a new email even when the admin sends verified: true", () =>
    Effect.gen(function* () {
      expect(yield* writtenBy({ email: "new@example.test", verified: true })).toMatchObject({
        email: "new@example.test",
        emailVerified: false,
      });
    })
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
