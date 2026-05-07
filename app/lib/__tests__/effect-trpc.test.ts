import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Exit, Cause } from "effect";
import { TRPCError } from "@trpc/server";
import { tagToTRPC } from "../effect-trpc";
import {
  NotFoundError,
  ValidationError,
  CreationError,
  UpdateError,
  DeletionError,
  QueryError,
  ConfigurationError,
  ExternalServiceError,
} from "@/models/errors/repository";
import {
  BucketBindingError,
  BucketUploadError,
  BucketGetError,
  BucketNotFoundError,
  BucketDeleteError,
  BucketListError,
  BucketValidationError,
} from "@/models/errors/bucket";
import { WorkflowTriggerError } from "@/models/errors/workflow";

const failExit = <E>(e: E) => Effect.exit(tagToTRPC(Effect.fail(e)));

const expectTRPC = (
  exit: Exit.Exit<unknown, TRPCError>,
  code: TRPCError["code"]
) => {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    const failure = Cause.failureOption(exit.cause);
    expect(failure._tag).toBe("Some");
    if (failure._tag === "Some") {
      expect(failure.value).toBeInstanceOf(TRPCError);
      expect(failure.value.code).toBe(code);
    }
  }
};

describe("tagToTRPC error mapping", () => {
  it.effect("NotFoundError → NOT_FOUND", () =>
    Effect.gen(function* () {
      const exit = yield* failExit(
        new NotFoundError({ entity: "user", identifier: "u1" })
      );
      expectTRPC(exit, "NOT_FOUND");
    })
  );

  it.effect("ValidationError → BAD_REQUEST", () =>
    Effect.gen(function* () {
      const exit = yield* failExit(
        new ValidationError({ entity: "user", message: "bad" })
      );
      expectTRPC(exit, "BAD_REQUEST");
    })
  );

  it.effect("CreationError → INTERNAL_SERVER_ERROR", () =>
    Effect.gen(function* () {
      const exit = yield* failExit(new CreationError({ entity: "user" }));
      expectTRPC(exit, "INTERNAL_SERVER_ERROR");
    })
  );

  it.effect("UpdateError → INTERNAL_SERVER_ERROR", () =>
    Effect.gen(function* () {
      const exit = yield* failExit(new UpdateError({ entity: "user" }));
      expectTRPC(exit, "INTERNAL_SERVER_ERROR");
    })
  );

  it.effect("DeletionError → INTERNAL_SERVER_ERROR", () =>
    Effect.gen(function* () {
      const exit = yield* failExit(new DeletionError({ entity: "user" }));
      expectTRPC(exit, "INTERNAL_SERVER_ERROR");
    })
  );

  it.effect("QueryError → INTERNAL_SERVER_ERROR", () =>
    Effect.gen(function* () {
      const exit = yield* failExit(new QueryError({ entity: "user" }));
      expectTRPC(exit, "INTERNAL_SERVER_ERROR");
    })
  );

  it.effect("ConfigurationError → INTERNAL_SERVER_ERROR", () =>
    Effect.gen(function* () {
      const exit = yield* failExit(
        new ConfigurationError({ service: "Database" })
      );
      expectTRPC(exit, "INTERNAL_SERVER_ERROR");
    })
  );

  it.effect("ExternalServiceError → BAD_GATEWAY", () =>
    Effect.gen(function* () {
      const exit = yield* failExit(
        new ExternalServiceError({ service: "BetterAuth" })
      );
      expectTRPC(exit, "BAD_GATEWAY");
    })
  );

  it.effect("BucketBindingError → INTERNAL_SERVER_ERROR", () =>
    Effect.gen(function* () {
      const exit = yield* failExit(new BucketBindingError({}));
      expectTRPC(exit, "INTERNAL_SERVER_ERROR");
    })
  );

  it.effect("BucketUploadError → INTERNAL_SERVER_ERROR", () =>
    Effect.gen(function* () {
      const exit = yield* failExit(new BucketUploadError({}));
      expectTRPC(exit, "INTERNAL_SERVER_ERROR");
    })
  );

  it.effect("BucketGetError → INTERNAL_SERVER_ERROR", () =>
    Effect.gen(function* () {
      const exit = yield* failExit(new BucketGetError({}));
      expectTRPC(exit, "INTERNAL_SERVER_ERROR");
    })
  );

  it.effect("BucketNotFoundError → NOT_FOUND", () =>
    Effect.gen(function* () {
      const exit = yield* failExit(new BucketNotFoundError({ key: "k" }));
      expectTRPC(exit, "NOT_FOUND");
    })
  );

  it.effect("BucketDeleteError → INTERNAL_SERVER_ERROR", () =>
    Effect.gen(function* () {
      const exit = yield* failExit(new BucketDeleteError({}));
      expectTRPC(exit, "INTERNAL_SERVER_ERROR");
    })
  );

  it.effect("BucketListError → INTERNAL_SERVER_ERROR", () =>
    Effect.gen(function* () {
      const exit = yield* failExit(new BucketListError({}));
      expectTRPC(exit, "INTERNAL_SERVER_ERROR");
    })
  );

  it.effect("BucketValidationError → BAD_REQUEST", () =>
    Effect.gen(function* () {
      const exit = yield* failExit(new BucketValidationError({ message: "x" }));
      expectTRPC(exit, "BAD_REQUEST");
    })
  );

  it.effect("WorkflowTriggerError → INTERNAL_SERVER_ERROR", () =>
    Effect.gen(function* () {
      const exit = yield* failExit(
        new WorkflowTriggerError({ name: "EXAMPLE_WORKFLOW" })
      );
      expectTRPC(exit, "INTERNAL_SERVER_ERROR");
    })
  );

  it.effect("Unknown error → INTERNAL_SERVER_ERROR", () =>
    Effect.gen(function* () {
      const exit = yield* failExit(new Error("rando"));
      expectTRPC(exit, "INTERNAL_SERVER_ERROR");
    })
  );

  it.effect("Pre-existing TRPCError passes through", () =>
    Effect.gen(function* () {
      const original = new TRPCError({ code: "FORBIDDEN", message: "no" });
      const exit = yield* failExit(original);
      expectTRPC(exit, "FORBIDDEN");
    })
  );

  it.effect("Success path is preserved", () =>
    Effect.gen(function* () {
      const result = yield* tagToTRPC(Effect.succeed(42));
      expect(result).toBe(42);
    })
  );
});
