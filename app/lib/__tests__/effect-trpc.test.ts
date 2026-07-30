import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Exit, Cause, Layer, ManagedRuntime, Option } from "effect";
import { TRPCError } from "@trpc/server";
import { tagToTRPC, runProcedure } from "../effect-trpc";
import { tryQuery } from "../effect-utils";
import { makeOtlpTracer, makeSpanBuffer } from "@/services/tracing";
import { Database, DatabaseLive } from "@/services/database";
import { CloudflareEnv } from "@/services/cloudflare";
import type { AppServices } from "@/runtime";
import type { AppError } from "@/models/errors";
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

  it.effect(
    "Unknown error does NOT leak the raw exception message to the client",
    () =>
      Effect.gen(function* () {
        const exit = yield* failExit(
          new Error("super secret internal stack trace detail")
        );
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const failure = Cause.failureOption(exit.cause);
          expect(failure._tag).toBe("Some");
          if (failure._tag === "Some") {
            expect(failure.value.message).toBe("Internal Server Error");
            expect(failure.value.message).not.toContain("secret");
          }
        }
      })
  );

  it.effect(
    "An object that duck-types a tagged error but isn't a known AppError tag falls through to the generic 500 branch (never throws)",
    () =>
      Effect.gen(function* () {
        const rogue = { _tag: "TotallyMadeUpError", message: "surprise" };
        const exit = yield* failExit(rogue);
        expectTRPC(exit, "INTERNAL_SERVER_ERROR");
        if (Exit.isFailure(exit)) {
          const failure = Cause.failureOption(exit.cause);
          if (failure._tag === "Some") {
            expect(failure.value.message).toBe("Internal Server Error");
          }
        }
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

describe("runProcedure", () => {
  it("resolves the value on success", async () => {
    const runtime = ManagedRuntime.make(
      Layer.empty
    ) as unknown as ManagedRuntime.ManagedRuntime<AppServices, AppError>;
    const result = await runProcedure(runtime, Effect.succeed(42));
    expect(result).toBe(42);
    await runtime.dispose();
  });

  it("maps a tagged-error failure to a TRPCError", async () => {
    const runtime = ManagedRuntime.make(
      Layer.empty
    ) as unknown as ManagedRuntime.ManagedRuntime<AppServices, AppError>;
    await expect(
      runProcedure(
        runtime,
        Effect.fail(new NotFoundError({ entity: "user", identifier: "u1" }))
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await runtime.dispose();
  });

  it("maps a layer-construction failure (e.g. missing DB binding) to a TRPCError instead of a raw rejection", async () => {
    // DatabaseLive fails fast with ConfigurationError when env.DATABASE is
    // missing. Previously `runProcedure` cast the runtime's error channel to
    // `never`, so this failure surfaced as a raw, unmapped rejection instead
    // of going through `toTRPC` like every other error.
    const brokenLayer = DatabaseLive.pipe(
      Layer.provide(Layer.succeed(CloudflareEnv, {} as Env))
    );
    const runtime = ManagedRuntime.make(brokenLayer) as unknown as
      ManagedRuntime.ManagedRuntime<AppServices, AppError>;

    const program = Effect.gen(function* () {
      yield* Database;
      return "unreachable";
    });

    await expect(runProcedure(runtime, program)).rejects.toBeInstanceOf(
      TRPCError
    );
    await expect(runProcedure(runtime, program)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Configuration error for Database (DATABASE)",
    });
    await runtime.dispose();
  });
});

describe("runProcedure span option", () => {
  // A runtime whose tracer records every ended span, so the root-span wiring is
  // observable without a collector.
  const tracingRuntime = () => {
    const buffer = makeSpanBuffer();
    const runtime = ManagedRuntime.make(
      Layer.setTracer(makeOtlpTracer(buffer))
    ) as unknown as ManagedRuntime.ManagedRuntime<AppServices, AppError>;
    return { buffer, runtime };
  };

  it("runs the effect inside a server-kind span named by options.span", async () => {
    // Catches: dropping the withSpan wiring or emitting the wrong kind — every
    // trace would lose its root and the db.* spans would be orphaned.
    const { buffer, runtime } = tracingRuntime();

    const result = await runProcedure(runtime, Effect.succeed(42), {
      span: "trpc.user.getUsers",
    });

    expect(result).toBe(42);
    expect(buffer.spans.map((s) => s.name)).toEqual(["trpc.user.getUsers"]);
    expect(buffer.spans[0].kind).toBe("server");
    await runtime.dispose();
  });

  it("creates no span when options is omitted", async () => {
    // Catches: unconditionally wrapping in a span (e.g. a hardcoded default
    // name), which would bury every procedure under one bogus span name.
    const { buffer, runtime } = tracingRuntime();

    await runProcedure(runtime, Effect.succeed(42));

    expect(buffer.spans).toHaveLength(0);
    await runtime.dispose();
  });

  it("makes db spans children of the procedure span, sharing its traceId", async () => {
    // Catches: wrapping the span outside runPromiseExit / around the wrong
    // effect, which would put the db call in its own trace and break the
    // log↔trace correlation the feature exists for.
    const { buffer, runtime } = tracingRuntime();

    await runProcedure(
      runtime,
      tryQuery("widget", async () => 1),
      { span: "trpc.user.getUsers" }
    );

    const root = buffer.spans.find((s) => s.name === "trpc.user.getUsers");
    const child = buffer.spans.find((s) => s.name === "db.query widget");
    expect(root).toBeDefined();
    expect(child).toBeDefined();
    expect(child!.traceId).toBe(root!.traceId);
    expect(
      Option.isSome(child!.parent) ? child!.parent.value.spanId : undefined
    ).toBe(root!.spanId);
    await runtime.dispose();
  });

  it("still maps a tagged-error failure to a TRPCError when a span is given", async () => {
    // Catches: the span pipe short-circuiting the Exit.match error mapping.
    const { buffer, runtime } = tracingRuntime();

    await expect(
      runProcedure(
        runtime,
        Effect.fail(new NotFoundError({ entity: "user", identifier: "u1" })),
        { span: "trpc.user.getUser" }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(buffer.spans.map((s) => s.name)).toEqual(["trpc.user.getUser"]);
    await runtime.dispose();
  });
});
