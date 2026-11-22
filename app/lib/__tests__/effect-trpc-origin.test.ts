import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option } from "effect";
import { TRPCError } from "@trpc/server";
import { runProcedure, tagToTRPC } from "../effect-trpc";
import type { AppServices } from "@/runtime";
import type { AppError } from "@/models/errors/app-error";
import { NotFoundError, QueryError } from "@/models/errors/repository";

const failExit = <E>(e: E) => Effect.exit(tagToTRPC(Effect.fail(e)));

const failureOf = (exit: Exit.Exit<unknown, TRPCError>): TRPCError | undefined =>
  Exit.isFailure(exit)
    ? Option.getOrUndefined(Cause.failureOption(exit.cause))
    : undefined;

describe("tagToTRPC keeps the origin for the error reporter", () => {
  it.effect("puts a 5xx-mapped tagged error itself on cause, so the reporter sees QueryError and not just its inner cause", () =>
    Effect.gen(function* () {
      const origin = new QueryError({ entity: "user", cause: new Error("D1 down") });

      const mapped = failureOf(yield* failExit(origin));

      expect(mapped?.code).toBe("INTERNAL_SERVER_ERROR");
      expect(mapped?.cause).toBe(origin);
    })
  );

  it.effect("leaves a 4xx-mapped tagged error without a cause, so a NOT_FOUND is not reported as a server failure", () =>
    Effect.gen(function* () {
      const mapped = failureOf(
        yield* failExit(new NotFoundError({ entity: "user", identifier: "u1" }))
      );

      expect(mapped?.code).toBe("NOT_FOUND");
      expect(mapped?.message).toBe("user not found: u1");
      expect(mapped?.cause).toBeUndefined();
    })
  );

  it.effect("puts an unknown error on cause of the 500, so the reporter gets its stack", () =>
    Effect.gen(function* () {
      const origin = new Error("rando");

      const mapped = failureOf(yield* failExit(origin));

      expect(mapped?.cause).toBe(origin);
    })
  );

  it("puts a defect on cause of the 500 from runProcedure, so a die is reported with its stack", async () => {
    const runtime = ManagedRuntime.make(
      Layer.empty
    ) as unknown as ManagedRuntime.ManagedRuntime<AppServices, AppError>;
    const defect = new Error("bug");

    const rejected = await runProcedure(runtime, Effect.die(defect)).catch(
      (error: unknown) => error
    );
    await runtime.dispose();

    expect(rejected).toBeInstanceOf(TRPCError);
    expect(rejected).toMatchObject({ code: "INTERNAL_SERVER_ERROR", cause: defect });
  });
});
