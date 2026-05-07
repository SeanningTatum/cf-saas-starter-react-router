import { Context, Effect, Layer } from "effect";
import { CloudflareEnv } from "./cloudflare";
import { BucketBindingError } from "@/models/errors/bucket";

export interface BucketShape {
  readonly bucket: R2Bucket;
}

export class Bucket extends Context.Tag("app/Bucket")<Bucket, BucketShape>() {}

export const BucketLive = Layer.effect(
  Bucket,
  Effect.gen(function* () {
    const env = yield* CloudflareEnv;
    if (!env.BUCKET) {
      return yield* Effect.fail(new BucketBindingError({}));
    }
    return { bucket: env.BUCKET };
  })
);
