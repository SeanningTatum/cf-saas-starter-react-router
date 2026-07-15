import { describe, it as itVitest, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer, Exit, Cause } from "effect";
import { UserRepository, isProtectedUser, buildUserConditions } from "../user";
import { Database } from "@/services/database";
import {
  chainable,
  chainableSpy,
  makeTestDatabase,
} from "@/services/database.test-layer";
import { user } from "@/db/schema";
import {
  NotFoundError,
  ValidationError,
  UpdateError,
  DeletionError,
} from "@/models/errors/repository";

const provideStub = (stub: unknown) =>
  UserRepository.Default.pipe(Layer.provide(makeTestDatabase(stub)));

describe("isProtectedUser", () => {
  itVitest("returns true for admin role", () => {
    expect(isProtectedUser({ role: "admin", id: "u1" }, "u2")).toBe(true);
  });
  itVitest("returns true when target is current user", () => {
    expect(isProtectedUser({ role: "user", id: "u1" }, "u1")).toBe(true);
  });
  itVitest("returns false for plain user that isn't current", () => {
    expect(isProtectedUser({ role: "user", id: "u1" }, "u2")).toBe(false);
  });
  itVitest("returns true when role is null and id matches current", () => {
    expect(isProtectedUser({ role: null, id: "u1" }, "u1")).toBe(true);
  });
});

describe("buildUserConditions", () => {
  itVitest("returns undefined for empty input", () => {
    expect(
      buildUserConditions({ page: 0, limit: 10 })
    ).toBeUndefined();
  });
  itVitest("returns SQL when search provided", () => {
    expect(
      buildUserConditions({ page: 0, limit: 10, search: "alice" })
    ).toBeDefined();
  });
  itVitest("returns SQL when role provided", () => {
    expect(
      buildUserConditions({ page: 0, limit: 10, role: "admin" })
    ).toBeDefined();
  });
  itVitest("returns SQL when multiple filters provided", () => {
    expect(
      buildUserConditions({
        page: 0,
        limit: 10,
        search: "x",
        role: "user",
        status: "verified",
      })
    ).toBeDefined();
  });
});

describe("UserRepository.getUser", () => {
  it.effect("fails with NotFoundError when user missing", () => {
    const stub = { select: () => chainable([]) };
    return Effect.gen(function* () {
      const repo = yield* UserRepository;
      const exit = yield* Effect.exit(repo.getUser({ userId: "missing" }));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        expect(failure._tag).toBe("Some");
        if (failure._tag === "Some") {
          expect(failure.value).toBeInstanceOf(NotFoundError);
          expect((failure.value as NotFoundError)._tag).toBe("NotFoundError");
        }
      }
    }).pipe(Effect.provide(provideStub(stub)));
  });

  it.effect("returns user when found", () => {
    const found = { id: "u1", name: "Alice", email: "a@b.c" };
    const stub = { select: () => chainable([found]) };
    return Effect.gen(function* () {
      const repo = yield* UserRepository;
      const result = yield* repo.getUser({ userId: "u1" });
      expect(result).toEqual(found);
    }).pipe(Effect.provide(provideStub(stub)));
  });
});

describe("UserRepository.getUsers", () => {
  it.effect("returns paged rows with total/totalPages/page/limit", () => {
    let call = 0;
    const rows = [{ id: "u1" }, { id: "u2" }];
    const responses = [rows, [{ count: 25 }]];
    const stub = { select: () => chainable(responses[call++]) };
    return Effect.gen(function* () {
      const repo = yield* UserRepository;
      const result = yield* repo.getUsers({ page: 1, limit: 10 });
      expect(result.users).toEqual(rows);
      expect(result.total).toBe(25);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
      expect(result.totalPages).toBe(3);
    }).pipe(Effect.provide(provideStub(stub)));
  });
});

describe("UserRepository.bulkBanUsers", () => {
  it.effect("returns 0 for empty userIds without touching db", () =>
    Effect.gen(function* () {
      const repo = yield* UserRepository;
      const n = yield* repo.bulkBanUsers({ userIds: [] });
      expect(n).toBe(0);
    }).pipe(Effect.provide(provideStub({})))
  );

  it.effect("bans the given users and returns the count", () => {
    const updateSpy = chainableSpy(undefined);
    const stub = { update: updateSpy };
    return Effect.gen(function* () {
      const repo = yield* UserRepository;
      const n = yield* repo.bulkBanUsers({
        userIds: ["a", "b"],
        reason: "spam",
      });
      expect(n).toBe(2);
      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith(user);
    }).pipe(Effect.provide(provideStub(stub)));
  });

  it.effect("fails with UpdateError when the update throws", () => {
    const stub = {
      update: () => {
        throw new Error("update boom");
      },
    };
    return Effect.gen(function* () {
      const repo = yield* UserRepository;
      const exit = yield* Effect.exit(
        repo.bulkBanUsers({ userIds: ["a"] })
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        if (failure._tag === "Some") {
          expect(failure.value).toBeInstanceOf(UpdateError);
        }
      }
    }).pipe(Effect.provide(provideStub(stub)));
  });
});

describe("UserRepository.bulkDeleteUsers", () => {
  it.effect("returns 0 for empty userIds without touching db", () =>
    Effect.gen(function* () {
      const repo = yield* UserRepository;
      const n = yield* repo.bulkDeleteUsers({ userIds: [] });
      expect(n).toBe(0);
    }).pipe(Effect.provide(provideStub({})))
  );

  it.effect("deletes the given users and returns the count", () => {
    const deleteSpy = chainableSpy(undefined);
    const stub = { delete: deleteSpy };
    return Effect.gen(function* () {
      const repo = yield* UserRepository;
      const n = yield* repo.bulkDeleteUsers({ userIds: ["a", "b", "c"] });
      expect(n).toBe(3);
      expect(deleteSpy).toHaveBeenCalledTimes(1);
      expect(deleteSpy).toHaveBeenCalledWith(user);
    }).pipe(Effect.provide(provideStub(stub)));
  });

  it.effect("fails with DeletionError when the delete throws", () => {
    const stub = {
      delete: () => {
        throw new Error("delete boom");
      },
    };
    return Effect.gen(function* () {
      const repo = yield* UserRepository;
      const exit = yield* Effect.exit(
        repo.bulkDeleteUsers({ userIds: ["a"] })
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        if (failure._tag === "Some") {
          expect(failure.value).toBeInstanceOf(DeletionError);
        }
      }
    }).pipe(Effect.provide(provideStub(stub)));
  });
});

describe("UserRepository.bulkUpdateUserRoles", () => {
  it.effect("returns 0 for empty userIds without touching db", () =>
    Effect.gen(function* () {
      const repo = yield* UserRepository;
      const n = yield* repo.bulkUpdateUserRoles({ userIds: [], role: "user" });
      expect(n).toBe(0);
    }).pipe(Effect.provide(provideStub({})))
  );

  it.effect("updates roles for the given users and returns the count", () => {
    const updateSpy = chainableSpy(undefined);
    const stub = { update: updateSpy };
    return Effect.gen(function* () {
      const repo = yield* UserRepository;
      const n = yield* repo.bulkUpdateUserRoles({
        userIds: ["a", "b"],
        role: "admin",
      });
      expect(n).toBe(2);
      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith(user);
    }).pipe(Effect.provide(provideStub(stub)));
  });

  it.effect("fails with UpdateError when the update throws", () => {
    const stub = {
      update: () => {
        throw new Error("update boom");
      },
    };
    return Effect.gen(function* () {
      const repo = yield* UserRepository;
      const exit = yield* Effect.exit(
        repo.bulkUpdateUserRoles({ userIds: ["a"], role: "admin" })
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        if (failure._tag === "Some") {
          expect(failure.value).toBeInstanceOf(UpdateError);
        }
      }
    }).pipe(Effect.provide(provideStub(stub)));
  });
});

describe("UserRepository.filterProtectedUsers", () => {
  it.effect("filters admins and self, returns valid ids", () => {
    const usersFromDb = [
      { id: "alice", role: "user" },
      { id: "bob-admin", role: "admin" },
      { id: "self", role: "user" },
      { id: "carol", role: "user" },
    ];
    const stub = { select: () => chainable(usersFromDb) };
    return Effect.gen(function* () {
      const repo = yield* UserRepository;
      const result = yield* repo.filterProtectedUsers({
        userIds: ["alice", "bob-admin", "self", "carol"],
        currentUserId: "self",
      });
      expect(result.validUserIds.sort()).toEqual(["alice", "carol"]);
      expect(result.skippedCount).toBe(2);
    }).pipe(Effect.provide(provideStub(stub)));
  });

  it.effect("returns empty result for empty input", () =>
    Effect.gen(function* () {
      const repo = yield* UserRepository;
      const result = yield* repo.filterProtectedUsers({
        userIds: [],
        currentUserId: "self",
      });
      expect(result.validUserIds).toEqual([]);
      expect(result.skippedCount).toBe(0);
    }).pipe(Effect.provide(provideStub({})))
  );
});

describe("UserRepository.updateUser", () => {
  it.effect("fails with NotFoundError when user missing", () => {
    const stub = { select: () => chainable([]) };
    return Effect.gen(function* () {
      const repo = yield* UserRepository;
      const exit = yield* Effect.exit(
        repo.updateUser({
          userId: "missing",
          currentUserId: "actor",
          data: { name: "x" },
        })
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        if (failure._tag === "Some") {
          expect((failure.value as { _tag: string })._tag).toBe(
            "NotFoundError"
          );
        }
      }
    }).pipe(Effect.provide(provideStub(stub)));
  });

  it.effect("fails with ValidationError when target is admin", () => {
    const stub = {
      select: () => chainable([{ id: "u1", role: "admin" }]),
    };
    return Effect.gen(function* () {
      const repo = yield* UserRepository;
      const exit = yield* Effect.exit(
        repo.updateUser({
          userId: "u1",
          currentUserId: "actor",
          data: { name: "x" },
        })
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        if (failure._tag === "Some") {
          expect(failure.value).toBeInstanceOf(ValidationError);
        }
      }
    }).pipe(Effect.provide(provideStub(stub)));
  });

  it.effect("fails with ValidationError when target is self", () => {
    const stub = {
      select: () => chainable([{ id: "actor", role: "user" }]),
    };
    return Effect.gen(function* () {
      const repo = yield* UserRepository;
      const exit = yield* Effect.exit(
        repo.updateUser({
          userId: "actor",
          currentUserId: "actor",
          data: { name: "x" },
        })
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        if (failure._tag === "Some") {
          expect((failure.value as { _tag: string })._tag).toBe(
            "ValidationError"
          );
        }
      }
    }).pipe(Effect.provide(provideStub(stub)));
  });

  it.effect("updates a valid non-protected target and returns success", () => {
    const stub = {
      select: () => chainable([{ id: "u1", role: "user" }]),
      update: () => chainable(undefined),
    };
    return Effect.gen(function* () {
      const repo = yield* UserRepository;
      const result = yield* repo.updateUser({
        userId: "u1",
        currentUserId: "actor",
        data: { name: "New Name" },
      });
      expect(result).toEqual({ success: true });
    }).pipe(Effect.provide(provideStub(stub)));
  });
});

describe("UserRepository.unbanUser", () => {
  it.effect("fails with NotFoundError when user missing", () => {
    const stub = { select: () => chainable([]) };
    return Effect.gen(function* () {
      const repo = yield* UserRepository;
      const exit = yield* Effect.exit(repo.unbanUser({ userId: "missing" }));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        if (failure._tag === "Some") {
          expect((failure.value as { _tag: string })._tag).toBe(
            "NotFoundError"
          );
        }
      }
    }).pipe(Effect.provide(provideStub(stub)));
  });

  it.effect("unbans a found user and returns success", () => {
    const stub = {
      select: () => chainable([{ id: "u1" }]),
      update: () => chainable(undefined),
    };
    return Effect.gen(function* () {
      const repo = yield* UserRepository;
      const result = yield* repo.unbanUser({ userId: "u1" });
      expect(result).toEqual({ success: true });
    }).pipe(Effect.provide(provideStub(stub)));
  });
});

describe("UserRepository.deleteUser", () => {
  it.effect("fails with ValidationError when target is self", () => {
    const stub = {
      select: () => chainable([{ id: "actor", role: "user" }]),
    };
    return Effect.gen(function* () {
      const repo = yield* UserRepository;
      const exit = yield* Effect.exit(
        repo.deleteUser({ userId: "actor", currentUserId: "actor" })
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        if (failure._tag === "Some") {
          expect((failure.value as { _tag: string })._tag).toBe(
            "ValidationError"
          );
        }
      }
    }).pipe(Effect.provide(provideStub(stub)));
  });

  it.effect("deletes a valid non-protected target and returns success", () => {
    const stub = {
      select: () => chainable([{ id: "u1", role: "user" }]),
      delete: () => chainable(undefined),
    };
    return Effect.gen(function* () {
      const repo = yield* UserRepository;
      const result = yield* repo.deleteUser({
        userId: "u1",
        currentUserId: "actor",
      });
      expect(result).toEqual({ success: true });
    }).pipe(Effect.provide(provideStub(stub)));
  });
});

describe("UserRepository.banUser", () => {
  it.effect("fails with ValidationError when target is admin", () => {
    const stub = {
      select: () => chainable([{ id: "u1", role: "admin" }]),
    };
    return Effect.gen(function* () {
      const repo = yield* UserRepository;
      const exit = yield* Effect.exit(
        repo.banUser({
          userId: "u1",
          currentUserId: "actor",
        })
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        if (failure._tag === "Some") {
          expect(failure.value).toBeInstanceOf(ValidationError);
        }
      }
    }).pipe(Effect.provide(provideStub(stub)));
  });

  it.effect("bans a valid non-protected target and returns success", () => {
    const stub = {
      select: () => chainable([{ id: "u1", role: "user" }]),
      update: () => chainable(undefined),
    };
    return Effect.gen(function* () {
      const repo = yield* UserRepository;
      const result = yield* repo.banUser({
        userId: "u1",
        currentUserId: "actor",
        reason: "spam",
      });
      expect(result).toEqual({ success: true });
    }).pipe(Effect.provide(provideStub(stub)));
  });
});
