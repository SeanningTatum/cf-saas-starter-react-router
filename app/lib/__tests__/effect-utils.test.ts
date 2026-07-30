import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Exit, Cause, Layer } from "effect";
import { makeOtlpTracer, makeSpanBuffer } from "@/services/tracing";
import {
  tryQuery,
  tryUpdate,
  tryCreate,
  tryDelete,
  requireFound,
  requireFoundOrFail,
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

describe("db spans", () => {
  // The tracer from `@/services/tracing` doubles as the capture tracer here:
  // it records every ended span in a plain buffer.
  const captureTracer = () => {
    const buffer = makeSpanBuffer();
    return { buffer, layer: Layer.setTracer(makeOtlpTracer(buffer)) };
  };

  it.effect(
    "each helper wraps its query in one client span named `db.<op> <entity>`",
    () => {
      // Catches: renaming/typo'ing an operation, forgetting to wrap one of the
      // four helpers, or losing `kind: "client"` — trace UIs would stop showing
      // D1 calls as outbound dependency edges of the procedure span.
      const { buffer, layer } = captureTracer();
      return Effect.gen(function* () {
        yield* tryQuery("widget", async () => 1);
        yield* tryCreate("widget", async () => 1);
        yield* tryUpdate("widget", async () => 1);
        yield* tryDelete("widget", async () => 1);

        expect(buffer.spans.map((s) => s.name)).toEqual([
          "db.query widget",
          "db.create widget",
          "db.update widget",
          "db.delete widget",
        ]);
        expect(buffer.spans.map((s) => s.kind)).toEqual([
          "client",
          "client",
          "client",
          "client",
        ]);
        expect(buffer.spans[0].attributes.get("db.operation")).toBe("query");
        expect(buffer.spans[0].attributes.get("db.entity")).toBe("widget");
      }).pipe(Effect.provide(layer));
    }
  );

  it.effect(
    "a rejected query still fails with its tagged error and ends the span as failed",
    () => {
      // Catches: the withSpan wrapper swallowing/reshaping the failure, or the
      // span closing as OK on a failed query (errors invisible in traces).
      const { buffer, layer } = captureTracer();
      return Effect.gen(function* () {
        const exit = yield* Effect.exit(
          tryQuery("widget", async () => {
            throw new Error("boom");
          })
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const failure = Cause.failureOption(exit.cause);
          expect(failure._tag).toBe("Some");
          if (failure._tag === "Some") {
            expect(failure.value).toBeInstanceOf(QueryError);
          }
        }
        expect(buffer.spans).toHaveLength(1);
        const status = buffer.spans[0].status;
        expect(status._tag).toBe("Ended");
        if (status._tag === "Ended") {
          expect(Exit.isFailure(status.exit)).toBe(true);
        }
      }).pipe(Effect.provide(layer));
    }
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

describe("requireFoundOrFail", () => {
  it.effect("returns the value when present", () =>
    Effect.gen(function* () {
      const v = yield* requireFoundOrFail({ id: "id-1" }, () => new Error("unused"));
      expect(v).toEqual({ id: "id-1" });
    })
  );

  it.effect("fails with the caller-provided error on null", () =>
    Effect.gen(function* () {
      class CustomError {
        readonly _tag = "CustomError";
      }
      const exit = yield* Effect.exit(
        requireFoundOrFail(null, () => new CustomError())
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        if (failure._tag === "Some") {
          expect(failure.value).toBeInstanceOf(CustomError);
        }
      }
    })
  );

  it.effect("fails with the caller-provided error on undefined", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        requireFoundOrFail(undefined, () => "missing")
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        if (failure._tag === "Some") {
          expect(failure.value).toBe("missing");
        }
      }
    })
  );
});
