import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Exit, Cause } from "effect";
import {
  tryQuery,
  tryUpdate,
  tryCreate,
  tryDelete,
  requireFound,
} from "../effect-utils";
import {
  QueryError,
  UpdateError,
  CreationError,
  DeletionError,
  NotFoundError,
} from "@/models/errors/repository";

describe("tryQuery", () => {
  it.effect("succeeds and returns value", () =>
    Effect.gen(function* () {
      const result = yield* tryQuery("widget", async () => 42);
      expect(result).toBe(42);
    })
  );

  it.effect("wraps thrown error as QueryError", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        tryQuery("widget", async () => {
          throw new Error("boom");
        })
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        if (failure._tag === "Some") {
          expect(failure.value).toBeInstanceOf(QueryError);
          expect((failure.value as QueryError).entity).toBe("widget");
        }
      }
    })
  );
});

describe("tryUpdate", () => {
  it.effect("wraps thrown error as UpdateError", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        tryUpdate("widget", async () => {
          throw new Error("boom");
        })
      );
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        if (failure._tag === "Some") {
          expect(failure.value).toBeInstanceOf(UpdateError);
        }
      }
    })
  );
});

describe("tryCreate", () => {
  it.effect("wraps thrown error as CreationError", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        tryCreate("widget", async () => {
          throw new Error("boom");
        })
      );
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        if (failure._tag === "Some") {
          expect(failure.value).toBeInstanceOf(CreationError);
        }
      }
    })
  );
});

describe("tryDelete", () => {
  it.effect("wraps thrown error as DeletionError", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        tryDelete("widget", async () => {
          throw new Error("boom");
        })
      );
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        if (failure._tag === "Some") {
          expect(failure.value).toBeInstanceOf(DeletionError);
        }
      }
    })
  );
});

describe("requireFound", () => {
  it.effect("returns the value when present", () =>
    Effect.gen(function* () {
      const v = yield* requireFound("widget", "id-1", { id: "id-1" });
      expect(v).toEqual({ id: "id-1" });
    })
  );

  it.effect("fails with NotFoundError on null", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(requireFound("widget", "id-1", null));
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        if (failure._tag === "Some") {
          expect(failure.value).toBeInstanceOf(NotFoundError);
          expect((failure.value as NotFoundError).identifier).toBe("id-1");
        }
      }
    })
  );

  it.effect("fails with NotFoundError on undefined", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(requireFound("widget", "id-1", undefined));
      expect(Exit.isFailure(exit)).toBe(true);
    })
  );
});
