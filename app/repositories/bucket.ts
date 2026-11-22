import { Effect } from "effect";
import { Bucket } from "@/services/bucket";
import { requireFoundOrFail } from "@/lib/effect-utils";
import {
  BucketUploadError,
  BucketGetError,
  BucketNotFoundError,
  BucketDeleteError,
  BucketListError,
} from "@/models/errors/bucket";
import type { UploadOptions, ListR2Input } from "@/lib/schemas/bucket";
import {
  R2_DELETE_SPAN,
  R2_GET_SPAN,
  R2_LIST_SPAN,
  R2_PUT_SPAN,
} from "@/lib/constants/spans";

const r2Span = (name: string) => Effect.withSpan(name, { kind: "client" });

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
        }).pipe(r2Span(R2_PUT_SPAN));

      const get = (key: string) =>
        Effect.gen(function* () {
          const object = yield* Effect.tryPromise({
            try: () => bucket.get(key),
            catch: (cause) => new BucketGetError({ cause }),
          }).pipe(r2Span(R2_GET_SPAN));
          return yield* requireFoundOrFail(object, () => new BucketNotFoundError({ key }));
        });

      const remove = (key: string) =>
        Effect.tryPromise({
          try: () => bucket.delete(key),
          catch: (cause) => new BucketDeleteError({ cause }),
        }).pipe(r2Span(R2_DELETE_SPAN));

      const list = (input: ListR2Input = { limit: 1000 }) =>
        Effect.tryPromise({
          try: () => bucket.list({ prefix: input.prefix, limit: input.limit }),
          catch: (cause) => new BucketListError({ cause }),
        }).pipe(r2Span(R2_LIST_SPAN));

      return { upload, get, remove, list } as const;
    }),
  }
) {}
