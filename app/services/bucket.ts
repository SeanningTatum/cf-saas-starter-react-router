import { Context, Effect, Layer } from "effect";
import { CloudflareEnv } from "./cloudflare";
import { BucketBindingError } from "@/models/errors/bucket";

export interface BucketShape {
  readonly bucket: R2Bucket;
}

type EnvWhereR2MayBeOff = Env & { BUCKET?: R2Bucket };

export class Bucket extends Context.Tag("app/Bucket")<Bucket, BucketShape>() {}

export const BucketLive = Layer.effect(
  Bucket,
  Effect.gen(function* () {
    const env = yield* CloudflareEnv;
    const bucket = (env as EnvWhereR2MayBeOff).BUCKET;
    if (!bucket) {
      return yield* Effect.fail(new BucketBindingError({}));
    }
    return { bucket };
  })
);
