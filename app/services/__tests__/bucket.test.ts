import { describe, expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Exit, Cause, Layer } from "effect";
import { Bucket, BucketLive } from "../bucket";
import { CloudflareEnv } from "../cloudflare";
import { BucketBindingError } from "@/models/errors/bucket";

const envLayer = (env: Partial<Env>) =>
  Layer.succeed(CloudflareEnv, env as Env);

const fakeBucket = { put: () => {}, get: () => {} } as unknown as R2Bucket;

describe("BucketLive", () => {
  it.effect("provides bucket when binding present", () =>
    Effect.gen(function* () {
      const { bucket } = yield* Bucket;
      expect(bucket).toBe(fakeBucket);
    }).pipe(
      Effect.provide(
        BucketLive.pipe(Layer.provide(envLayer({ BUCKET: fakeBucket })))
      )
    )
  );

  it.effect("fails with BucketBindingError when binding missing", () =>
    Effect.gen(function* () {
      const program = Bucket.pipe(
        Effect.provide(
          BucketLive.pipe(
            Layer.provide(envLayer({ BUCKET: undefined as unknown as R2Bucket }))
          )
        )
      );
      const exit = yield* Effect.exit(program);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        expect(failure._tag).toBe("Some");
        if (failure._tag === "Some") {
          expect(failure.value).toBeInstanceOf(BucketBindingError);
        }
      }
    })
  );
});
