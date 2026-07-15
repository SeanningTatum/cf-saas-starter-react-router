import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Exit, Cause, Layer } from "effect";
import { Database, DatabaseLive } from "../database";
import { CloudflareEnv } from "../cloudflare";
import { ConfigurationError } from "@/models/errors/repository";

const envLayer = (env: Partial<Env>) =>
  Layer.succeed(CloudflareEnv, env as Env);

const fakeD1 = {} as D1Database;

describe("DatabaseLive", () => {
  it.effect("provides a db when DATABASE binding present", () =>
    Effect.gen(function* () {
      const { db } = yield* Database;
      expect(db).toBeDefined();
    }).pipe(
      Effect.provide(
        DatabaseLive.pipe(Layer.provide(envLayer({ DATABASE: fakeD1 })))
      )
    )
  );

  it.effect("fails with ConfigurationError when DATABASE binding missing", () =>
    Effect.gen(function* () {
      const program = Database.pipe(
        Effect.provide(
          DatabaseLive.pipe(
            Layer.provide(envLayer({ DATABASE: undefined as unknown as D1Database }))
          )
        )
      );
      const exit = yield* Effect.exit(program);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        expect(failure._tag).toBe("Some");
        if (failure._tag === "Some") {
          expect(failure.value).toBeInstanceOf(ConfigurationError);
          expect((failure.value as ConfigurationError).service).toBe("Database");
          expect((failure.value as ConfigurationError).field).toBe("DATABASE");
        }
      }
    })
  );
});
