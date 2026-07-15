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
    // BUCKET is absent from the generated Env type when setup is run with R2
    // disabled (no r2_buckets in wrangler.jsonc). Treat it as optional so the
    // runtime guard below type-checks in both R2-enabled and R2-disabled configs.
    const bucket = (env as Env & { BUCKET?: R2Bucket }).BUCKET;
    if (!bucket) {
      return yield* Effect.fail(new BucketBindingError({}));
    }
    return { bucket };
  })
);
