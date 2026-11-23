import { describe, it as itVitest, expect, vi } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { UserRepository, buildUserConditions } from "../user";
import { isProtectedUser } from "@/auth/protected-user";
import { chainable, chainableSpy, makeTestDatabase } from "@/services/database.test-layer";
import { UpdateError, DeletionError } from "@/models/errors/repository";

const provideStub = (stub: unknown) =>
  UserRepository.Default.pipe(Layer.provide(makeTestDatabase(stub)));

const throwing = (message: string) => () => {
  throw new Error(message);
};

describe("isProtectedUser", () => {
  itVitest("protects an admin target, so one admin cannot act on another", () => {
    expect(isProtectedUser({ role: "admin", id: "u1" }, "u2")).toBe(true);
  });
  itVitest("protects the actor's own row, so an admin cannot act on themselves", () => {
    expect(isProtectedUser({ role: "user", id: "u1" }, "u1")).toBe(true);
  });
  itVitest("leaves a plain user who is not the actor open, so bulk actions still work", () => {
    expect(isProtectedUser({ role: "user", id: "u1" }, "u2")).toBe(false);
  });
  itVitest("protects the actor's own row even when its role is null", () => {
    expect(isProtectedUser({ role: null, id: "u1" }, "u1")).toBe(true);
  });
});

describe("buildUserConditions", () => {
  itVitest(
    "returns no WHERE for an unfiltered list, so the query does not filter on nothing",
    () => {
      expect(buildUserConditions({ page: 0, limit: 10 })).toBeUndefined();
    },
  );
  itVitest("returns a WHERE for each filter alone and together, so no filter is dropped", () => {
    expect(buildUserConditions({ page: 0, limit: 10, search: "alice" })).toBeDefined();
    expect(buildUserConditions({ page: 0, limit: 10, role: "admin" })).toBeDefined();
    expect(
      buildUserConditions({ page: 0, limit: 10, search: "x", role: "user", status: "verified" }),
    ).toBeDefined();
  });
});

describe("UserRepository short-circuits on empty input", () => {
  it.effect(
    "returns 0 or an empty result for empty ids without touching the db, so an empty IN () never reaches D1",
    () =>
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        expect(yield* repo.bulkBanUsers({ userIds: [] })).toBe(0);
        expect(yield* repo.bulkDeleteUsers({ userIds: [] })).toBe(0);
        expect(yield* repo.bulkUpdateUserRoles({ userIds: [], role: "user" })).toBe(0);
        expect(yield* repo.filterProtectedUsers({ userIds: [], currentUserId: "self" })).toEqual({
          validUserIds: [],
          skippedCount: 0,
        });
      }).pipe(Effect.provide(provideStub({}))),
  );
});

describe("UserRepository maps a failing write to a tagged error", () => {
  it.effect(
    "bulkBanUsers fails with UpdateError when the update throws, so the client gets a tagged error, not a 500",
    () =>
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        const error = yield* Effect.flip(repo.bulkBanUsers({ userIds: ["a"] }));
        expect(error).toBeInstanceOf(UpdateError);
      }).pipe(Effect.provide(provideStub({ update: throwing("update boom") }))),
  );

  it.effect(
    "bulkDeleteUsers fails with DeletionError when the delete throws, so the client gets a tagged error, not a 500",
    () =>
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        const error = yield* Effect.flip(repo.bulkDeleteUsers({ userIds: ["a"] }));
        expect(error).toBeInstanceOf(DeletionError);
      }).pipe(Effect.provide(provideStub({ delete: throwing("delete boom") }))),
  );

  it.effect(
    "bulkUpdateUserRoles fails with UpdateError when the update throws, so the client gets a tagged error, not a 500",
    () =>
      Effect.gen(function* () {
        const repo = yield* UserRepository;
        const error = yield* Effect.flip(
          repo.bulkUpdateUserRoles({ userIds: ["a"], role: "admin" }),
        );
        expect(error).toBeInstanceOf(UpdateError);
      }).pipe(Effect.provide(provideStub({ update: throwing("update boom") }))),
  );

  it.effect(
    "banUser fails with UpdateError when the batch rejects, so a failed ban batch is not a defect (a 500 with no tag)",
    () => {
      const stub = {
        select: () => chainable([{ id: "u1", role: "user", email: "u1@example.test" }]),
        update: chainableSpy(undefined),
        delete: chainableSpy(undefined),
        batch: vi.fn(() => Promise.reject(new Error("batch boom"))),
      };
      return Effect.gen(function* () {
        const repo = yield* UserRepository;
        const error = yield* Effect.flip(repo.banUser({ userId: "u1", currentUserId: "actor" }));
        expect(error).toBeInstanceOf(UpdateError);
      }).pipe(Effect.provide(provideStub(stub)));
    },
  );
});
