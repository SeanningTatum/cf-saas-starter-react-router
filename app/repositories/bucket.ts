import { Effect } from "effect";
import { Bucket } from "@/services/bucket";
import {
  BucketUploadError,
  BucketGetError,
  BucketDeleteError,
  BucketListError,
} from "@/models/errors/bucket";
import type { UploadOptions, ListR2Input } from "@/lib/schemas/bucket";

const generateKey = () =>
  `uploads/${Date.now()}-${crypto.randomUUID()}`;

export class BucketRepository extends Effect.Service<BucketRepository>()(
  "app/BucketRepository",
  {
    effect: Effect.gen(function* () {
      const { bucket } = yield* Bucket;

      const upload = (
        file: Blob | Uint8Array | string | File,
        options: UploadOptions = {}
      ) =>
        Effect.tryPromise({
          try: async () => {
            const key = options.key ?? generateKey();
            let data: Uint8Array | string;
            let contentType: string | undefined = options.contentType;
            if (file instanceof File) {
              data = new Uint8Array(await file.arrayBuffer());
              contentType = contentType ?? file.type;
            } else if (file instanceof Blob) {
              data = new Uint8Array(await file.arrayBuffer());
            } else {
              data = file;
            }
            await bucket.put(key, data as ArrayBuffer | string, {
              httpMetadata: contentType ? { contentType } : undefined,
            });
            return key;
          },
          catch: (cause) => new BucketUploadError({ cause }),
        });

      const get = (key: string) =>
        Effect.tryPromise({
          try: () => bucket.get(key),
          catch: (cause) => new BucketGetError({ cause }),
        });

      const remove = (key: string) =>
        Effect.tryPromise({
          try: () => bucket.delete(key),
          catch: (cause) => new BucketDeleteError({ cause }),
        });

      const list = (input: ListR2Input = { limit: 1000 }) =>
        Effect.tryPromise({
          try: () => bucket.list({ prefix: input.prefix, limit: input.limit }),
          catch: (cause) => new BucketListError({ cause }),
        });

      return { upload, get, remove, list } as const;
    }),
  }
) {}
